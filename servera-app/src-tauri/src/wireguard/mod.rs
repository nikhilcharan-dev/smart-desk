// Gateway manager for the built-in userspace WireGuard proxy.
//
// One gateway at a time ("solo mode", matching SSH tunnel gateways). While a
// gateway is active, dial paths call `resolve_first_hop` which transparently
// rewrites targets inside the gateway's AllowedIPs to a 127.0.0.1 loopback
// port forwarded through WireGuard.

pub mod engine;

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::{Arc, Mutex};

use ipnet::IpNet;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::profile_manager::Profile;
use crate::ssh_config::wireguard::WireGuardConfig;
use engine::{EngineHandle, EngineSignal, EngineSpec};

pub type GatewaySlot = Mutex<Option<ActiveGateway>>;

pub struct ActiveGateway {
    pub profile_id: Option<String>,
    pub endpoint: String,
    pub endpoint_ip: IpAddr,
    pub allowed_ips: Vec<IpNet>,
    /// (target_ip, target_port) -> loopback port
    pub forwards: HashMap<(IpAddr, u16), u16>,
    spec: EngineSpec,
    engine: EngineHandle,
    status: Arc<Mutex<String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WgForwardInfo {
    pub target: String,
    pub local_port: u16,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WgStatusPayload {
    pub profile_id: Option<String>,
    pub endpoint: String,
    pub status: String,
    pub message: Option<String>,
    pub forwards: Vec<WgForwardInfo>,
}

fn emit_status(app: &AppHandle, payload: &WgStatusPayload) {
    let _ = app.emit(
        "tunnel-status",
        serde_json::json!({
            "type": "wireguard",
            "profileId": payload.profile_id,
            "endpoint": payload.endpoint,
            "status": payload.status,
            "message": payload.message,
            "forwards": payload.forwards,
        }),
    );
}

fn status_payload(gw: &ActiveGateway, message: Option<String>) -> WgStatusPayload {
    WgStatusPayload {
        profile_id: gw.profile_id.clone(),
        endpoint: gw.endpoint.clone(),
        status: gw.status.lock().map(|s| s.clone()).unwrap_or_default(),
        message,
        forwards: gw
            .forwards
            .iter()
            .map(|((ip, port), local)| WgForwardInfo {
                target: format!("{}:{}", ip, port),
                local_port: *local,
            })
            .collect(),
    }
}

/// Splits a comma-separated AllowedIPs value into CIDR networks.
/// Bare addresses become host-length prefixes (/32 or /128).
pub fn parse_allowed_ips(s: &str) -> Result<Vec<IpNet>, String> {
    let mut nets = Vec::new();
    for part in s.split(',') {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        let net = if p.contains('/') {
            p.parse::<IpNet>()
                .map_err(|e| format!("Invalid AllowedIPs entry '{}': {}", p, e))?
        } else {
            let ip: IpAddr = p
                .parse()
                .map_err(|e| format!("Invalid AllowedIPs entry '{}': {}", p, e))?;
            IpNet::from(ip)
        };
        nets.push(net);
    }
    if nets.is_empty() {
        return Err("AllowedIPs is empty".to_string());
    }
    Ok(nets)
}

/// Whether `ip` should be routed through the gateway. Loopback and the
/// WireGuard endpoint itself are always excluded — with full-tunnel configs
/// (AllowedIPs = 0.0.0.0/0) routing either would break the app or the tunnel.
pub fn target_matches(allowed_ips: &[IpNet], endpoint_ip: IpAddr, ip: IpAddr) -> bool {
    if ip.is_loopback() || ip == endpoint_ip {
        return false;
    }
    allowed_ips.iter().any(|net| net.contains(&ip))
}

/// Resolves `host` to an IP, preferring IPv4 (system DNS; WireGuard's DNS=
/// setting is not used — VPN-internal hostnames are a documented limitation).
fn resolve_host(host: &str, port: u16) -> Result<IpAddr, String> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(ip);
    }
    let addrs: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("DNS lookup for {} failed: {}", host, e))?
        .collect();
    addrs
        .iter()
        .find(|a| a.is_ipv4())
        .or_else(|| addrs.first())
        .map(|a| a.ip())
        .ok_or_else(|| format!("DNS lookup for {} returned no addresses", host))
}

/// First IPv4 address from a WireGuard Interface Address value like
/// "10.13.13.2/24" or "10.13.13.2/24, fd00::2/64".
fn parse_interface_ip(address: &str) -> Result<IpAddr, String> {
    let mut first: Option<IpAddr> = None;
    for part in address.split(',') {
        let p = part.trim();
        let ip_str = p.split('/').next().unwrap_or(p);
        if let Ok(ip) = ip_str.parse::<IpAddr>() {
            if ip.is_ipv4() {
                return Ok(ip);
            }
            first.get_or_insert(ip);
        }
    }
    first.ok_or_else(|| format!("Invalid WireGuard interface Address '{}'", address))
}

fn build_spec(wg: &WireGuardConfig, private_key_b64: &str) -> Result<(EngineSpec, IpAddr), String> {
    let private_key = engine::decode_key_b64(private_key_b64)?;
    let peer_public_key = engine::decode_key_b64(&wg.public_key)
        .map_err(|e| format!("Peer PublicKey: {}", e))?;
    let preshared_key = match &wg.preshared_key {
        Some(psk) => Some(engine::decode_key_b64(psk).map_err(|e| format!("PresharedKey: {}", e))?),
        None => None,
    };

    let endpoint_addrs: Vec<SocketAddr> = wg
        .endpoint
        .to_socket_addrs()
        .map_err(|e| format!("Cannot resolve endpoint '{}': {}", wg.endpoint, e))?
        .collect();
    let endpoint_addr = endpoint_addrs
        .iter()
        .find(|a| a.is_ipv4())
        .or_else(|| endpoint_addrs.first())
        .copied()
        .ok_or_else(|| format!("Endpoint '{}' resolved to no addresses", wg.endpoint))?;

    let source_peer_ip = parse_interface_ip(&wg.interface_address)?;

    let spec = EngineSpec {
        source_peer_ip,
        private_key,
        peer_public_key,
        preshared_key,
        endpoint_addr,
        // Default to 25s keepalive when the .conf doesn't set one — desktop
        // clients are almost always behind NAT and go silent between commands.
        keepalive: wg.persistent_keepalive.or(Some(25)),
        mtu: wg.mtu.map(|m| m as usize).unwrap_or(1420),
    };
    Ok((spec, endpoint_addr.ip()))
}

fn start_engine(
    app: &AppHandle,
    spec: &EngineSpec,
    forwards: &HashMap<(IpAddr, u16), u16>,
    status: Arc<Mutex<String>>,
    profile_id: Option<String>,
    endpoint: String,
) -> Result<EngineHandle, String> {
    let forward_list: Vec<(IpAddr, u16, u16)> = forwards
        .iter()
        .map(|((ip, port), local)| (*ip, *port, *local))
        .collect();

    let app = app.clone();
    let forward_infos: Vec<WgForwardInfo> = forward_list
        .iter()
        .map(|(ip, port, local)| WgForwardInfo {
            target: format!("{}:{}", ip, port),
            local_port: *local,
        })
        .collect();

    EngineHandle::start(spec, &forward_list, move |signal| {
        let (new_status, message) = match signal {
            EngineSignal::Active => ("active", None),
            EngineSignal::NoTraffic => (
                "running",
                Some(
                    "No response from the WireGuard peer yet — check the keys and endpoint"
                        .to_string(),
                ),
            ),
        };
        if signal == EngineSignal::Active {
            if let Ok(mut s) = status.lock() {
                *s = new_status.to_string();
            }
        }
        emit_status(
            &app,
            &WgStatusPayload {
                profile_id: profile_id.clone(),
                endpoint: endpoint.clone(),
                status: new_status.to_string(),
                message,
                forwards: forward_infos.clone(),
            },
        );
    })
}

/// Starts (or replaces) the active gateway. Forwards are pre-seeded for every
/// saved profile whose IP lies inside AllowedIPs, so connecting to known
/// servers never needs an engine restart.
pub fn start_gateway(
    app: &AppHandle,
    slot: &GatewaySlot,
    profile_id: Option<String>,
    wg: &WireGuardConfig,
    private_key_b64: &str,
    seed_profiles: &[Profile],
) -> Result<WgStatusPayload, String> {
    // Drop any previous gateway first — two engines with the same key would
    // fight over the server-side session.
    if let Ok(mut guard) = slot.lock() {
        *guard = None;
    }

    emit_status(
        app,
        &WgStatusPayload {
            profile_id: profile_id.clone(),
            endpoint: wg.endpoint.clone(),
            status: "starting".to_string(),
            message: None,
            forwards: Vec::new(),
        },
    );

    let (spec, endpoint_ip) = build_spec(wg, private_key_b64)?;
    let allowed_ips = parse_allowed_ips(&wg.allowed_ips)?;

    let mut forwards: HashMap<(IpAddr, u16), u16> = HashMap::new();
    for profile in seed_profiles {
        if profile.wg_config.is_some() {
            continue; // gateway profiles themselves are not targets
        }
        if profile.wg_mode.as_deref() == Some("never") {
            continue;
        }
        // Seeding is parse-only (no DNS) — hostname profiles fall back to the
        // on-demand restart path when connected.
        if let Ok(ip) = profile.ip.parse::<IpAddr>() {
            if target_matches(&allowed_ips, endpoint_ip, ip) {
                forwards
                    .entry((ip, profile.port))
                    .or_insert(engine::alloc_loopback_port()?);
            }
        }
    }

    let status = Arc::new(Mutex::new("running".to_string()));
    let engine = start_engine(
        app,
        &spec,
        &forwards,
        status.clone(),
        profile_id.clone(),
        wg.endpoint.clone(),
    )
    .map_err(|e| {
        emit_status(
            app,
            &WgStatusPayload {
                profile_id: profile_id.clone(),
                endpoint: wg.endpoint.clone(),
                status: "error".to_string(),
                message: Some(e.clone()),
                forwards: Vec::new(),
            },
        );
        e
    })?;

    let gateway = ActiveGateway {
        profile_id,
        endpoint: wg.endpoint.clone(),
        endpoint_ip,
        allowed_ips,
        forwards,
        spec,
        engine,
        status,
    };

    let payload = status_payload(&gateway, None);
    if let Ok(mut guard) = slot.lock() {
        *guard = Some(gateway);
    }
    emit_status(app, &payload);
    Ok(payload)
}

/// Returns the loopback port forwarding to `ip:port`, restarting the engine
/// with an expanded forward list when the target isn't covered yet. A restart
/// resets existing gateway-routed connections (~1 RTT re-handshake).
pub fn ensure_forward(
    app: &AppHandle,
    slot: &GatewaySlot,
    ip: IpAddr,
    port: u16,
) -> Result<u16, String> {
    let mut guard = slot.lock().map_err(|_| "WireGuard state poisoned".to_string())?;
    let gw = guard
        .as_mut()
        .ok_or_else(|| "No active WireGuard gateway".to_string())?;

    if let Some(local) = gw.forwards.get(&(ip, port)) {
        return Ok(*local);
    }

    let local_port = engine::alloc_loopback_port()?;
    let mut forwards = gw.forwards.clone();
    forwards.insert((ip, port), local_port);

    emit_status(
        app,
        &WgStatusPayload {
            profile_id: gw.profile_id.clone(),
            endpoint: gw.endpoint.clone(),
            status: "restarting".to_string(),
            message: Some(format!(
                "Adding route to {}:{} — existing VPN connections were reset",
                ip, port
            )),
            forwards: Vec::new(),
        },
    );

    // Stop the old engine before starting the new one (same-key constraint),
    // then start with the expanded forward list. On failure the gateway is
    // gone — surface that clearly rather than keeping a half-dead state.
    let old = guard.take().unwrap();
    let ActiveGateway {
        profile_id,
        endpoint,
        endpoint_ip,
        allowed_ips,
        spec,
        engine,
        status,
        ..
    } = old;
    drop(engine);

    match start_engine(
        app,
        &spec,
        &forwards,
        status.clone(),
        profile_id.clone(),
        endpoint.clone(),
    ) {
        Ok(new_engine) => {
            let gateway = ActiveGateway {
                profile_id,
                endpoint,
                endpoint_ip,
                allowed_ips,
                forwards,
                spec,
                engine: new_engine,
                status,
            };
            let payload = status_payload(&gateway, None);
            *guard = Some(gateway);
            drop(guard);
            emit_status(app, &payload);
            Ok(local_port)
        }
        Err(e) => {
            drop(guard);
            emit_status(
                app,
                &WgStatusPayload {
                    profile_id,
                    endpoint,
                    status: "error".to_string(),
                    message: Some(format!("WireGuard restart failed: {}", e)),
                    forwards: Vec::new(),
                },
            );
            Err(format!("WireGuard restart failed: {}", e))
        }
    }
}

/// The single choke point for outbound dials. Returns the effective
/// `(host, port, proxy_jump)` to use: unchanged for direct connections, or
/// rewritten to a loopback WireGuard forward.
///
/// This codebase dials the LAST hop of a ProxyJump chain directly (the
/// recursion in `establish_session` walks the list back to front), so when a
/// jump chain is present it's the last hop that gets rewritten.
pub fn resolve_first_hop(
    app: &AppHandle,
    slot: &GatewaySlot,
    ip: &str,
    port: u16,
    proxy_jump: Option<&str>,
    wg_mode: Option<&str>,
) -> Result<(String, u16, Option<String>), String> {
    match proxy_jump {
        Some(jump) if !jump.trim().is_empty() => {
            let hops: Vec<&str> = jump.split(',').collect();
            let last = hops[hops.len() - 1];

            // Mirror establish_session's user@host:port parsing exactly.
            let (user, host_part) = match last.find('@') {
                Some(at) => (Some(&last[..at]), &last[at + 1..]),
                None => (None, last),
            };
            let (host, hop_port) = match host_part.find(':') {
                Some(colon) => (
                    &host_part[..colon],
                    host_part[colon + 1..].parse().unwrap_or(22),
                ),
                None => (host_part, 22),
            };

            let (new_host, new_port) = resolve_dial_target(app, slot, host, hop_port, wg_mode)?;
            if new_host == host && new_port == hop_port {
                return Ok((ip.to_string(), port, Some(jump.to_string())));
            }

            let rewritten = match user {
                Some(u) => format!("{}@{}:{}", u, new_host, new_port),
                None => format!("{}:{}", new_host, new_port),
            };
            let mut new_hops: Vec<String> = hops[..hops.len() - 1]
                .iter()
                .map(|h| h.to_string())
                .collect();
            new_hops.push(rewritten);
            Ok((ip.to_string(), port, Some(new_hops.join(","))))
        }
        _ => {
            let (host, port) = resolve_dial_target(app, slot, ip, port, wg_mode)?;
            Ok((host, port, None))
        }
    }
}

/// Decides whether `host:port` should go through the active gateway and
/// returns the effective dial address.
pub fn resolve_dial_target(
    app: &AppHandle,
    slot: &GatewaySlot,
    host: &str,
    port: u16,
    wg_mode: Option<&str>,
) -> Result<(String, u16), String> {
    let mode = wg_mode.unwrap_or("auto");
    if mode == "never" {
        return Ok((host.to_string(), port));
    }

    // Gather what we need, then release the lock — ensure_forward re-locks.
    let gateway_info = {
        let guard = slot.lock().map_err(|_| "WireGuard state poisoned".to_string())?;
        guard
            .as_ref()
            .map(|gw| (gw.endpoint_ip, gw.allowed_ips.clone()))
    };

    let (endpoint_ip, allowed_ips) = match gateway_info {
        Some(info) => info,
        None => {
            if mode == "always" {
                return Err(
                    "This profile requires the WireGuard gateway, but none is active".to_string(),
                );
            }
            return Ok((host.to_string(), port));
        }
    };

    let ip = match resolve_host(host, port) {
        Ok(ip) => ip,
        Err(e) => {
            if mode == "always" {
                return Err(e);
            }
            // Auto mode: an unresolvable host will fail on direct dial too;
            // let the SSH layer produce its usual error.
            return Ok((host.to_string(), port));
        }
    };

    if mode == "always" || target_matches(&allowed_ips, endpoint_ip, ip) {
        let local_port = ensure_forward(app, slot, ip, port)?;
        Ok(("127.0.0.1".to_string(), local_port))
    } else {
        Ok((host.to_string(), port))
    }
}

/// Stops the active gateway, if any.
pub fn stop_gateway(app: &AppHandle, slot: &GatewaySlot) {
    let stopped = slot.lock().ok().and_then(|mut guard| guard.take());
    if let Some(gw) = stopped {
        let endpoint = gw.endpoint.clone();
        let profile_id = gw.profile_id.clone();
        drop(gw);
        emit_status(
            app,
            &WgStatusPayload {
                profile_id,
                endpoint,
                status: "stopped".to_string(),
                message: None,
                forwards: Vec::new(),
            },
        );
    }
}

/// Snapshot of the active gateway for the frontend.
pub fn get_status(slot: &GatewaySlot) -> Option<WgStatusPayload> {
    slot.lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|gw| status_payload(gw, None)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowed_ips_parses_cidrs_and_bare_ips() {
        let nets = parse_allowed_ips("10.0.0.0/24, fd00::/64, 192.168.1.5").unwrap();
        assert_eq!(nets.len(), 3);
        assert_eq!(nets[2].prefix_len(), 32);
        assert!(parse_allowed_ips("").is_err());
        assert!(parse_allowed_ips("not-an-ip").is_err());
    }

    #[test]
    fn full_tunnel_excludes_loopback_and_endpoint() {
        let allowed = parse_allowed_ips("0.0.0.0/0").unwrap();
        let endpoint: IpAddr = "203.0.113.10".parse().unwrap();
        assert!(target_matches(&allowed, endpoint, "10.13.13.1".parse().unwrap()));
        assert!(target_matches(&allowed, endpoint, "8.8.8.8".parse().unwrap()));
        assert!(!target_matches(&allowed, endpoint, "127.0.0.1".parse().unwrap()));
        assert!(!target_matches(&allowed, endpoint, endpoint));
    }

    #[test]
    fn subnet_matching_is_scoped() {
        let allowed = parse_allowed_ips("10.13.13.0/24").unwrap();
        let endpoint: IpAddr = "203.0.113.10".parse().unwrap();
        assert!(target_matches(&allowed, endpoint, "10.13.13.7".parse().unwrap()));
        assert!(!target_matches(&allowed, endpoint, "10.13.14.7".parse().unwrap()));
        assert!(!target_matches(&allowed, endpoint, "192.168.1.1".parse().unwrap()));
    }

    #[test]
    fn interface_ip_prefers_v4() {
        assert_eq!(
            parse_interface_ip("fd00::2/64, 10.13.13.2/24").unwrap(),
            "10.13.13.2".parse::<IpAddr>().unwrap()
        );
        assert_eq!(
            parse_interface_ip("10.0.0.5/32").unwrap(),
            "10.0.0.5".parse::<IpAddr>().unwrap()
        );
        assert!(parse_interface_ip("garbage").is_err());
    }
}
