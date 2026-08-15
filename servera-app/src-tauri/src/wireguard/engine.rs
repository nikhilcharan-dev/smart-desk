// Thin adapter around the `onetun` userspace WireGuard implementation.
// All onetun API usage is confined to this file so the crate can be swapped
// or vendored without touching the rest of the app.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine as _;
use onetun::config::{Config, PortForwardConfig, PortProtocol, PublicKey, StaticSecret};
use onetun::events::{Bus, Event};

/// Signals surfaced from the engine's event monitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineSignal {
    /// First decrypted packet arrived from the peer — the tunnel is passing traffic.
    Active,
    /// A client connected to a forward but nothing came back within the grace
    /// period. Usually means wrong keys or an unreachable endpoint (WireGuard
    /// has no explicit handshake-failure event).
    NoTraffic,
}

/// Everything needed to build a WireGuard session, keys already decoded.
#[derive(Clone)]
pub struct EngineSpec {
    pub source_peer_ip: IpAddr,
    pub private_key: [u8; 32],
    pub peer_public_key: [u8; 32],
    pub preshared_key: Option<[u8; 32]>,
    pub endpoint_addr: SocketAddr,
    pub keepalive: Option<u16>,
    pub mtu: usize,
}

/// A running userspace WireGuard instance. Dropping the handle tears down the
/// dedicated runtime, which kills every onetun task and closes the UDP socket.
pub struct EngineHandle {
    runtime: Option<tokio::runtime::Runtime>,
}

impl Drop for EngineHandle {
    fn drop(&mut self) {
        if let Some(rt) = self.runtime.take() {
            // Non-blocking shutdown: safe to call from async contexts.
            rt.shutdown_background();
        }
    }
}

impl EngineHandle {
    /// Starts a WireGuard instance with the given TCP forwards
    /// `(target_ip, target_port, local_port)`. Forwards are fixed for the
    /// lifetime of the instance (onetun registers destinations at
    /// construction) — adding one requires a restart.
    pub fn start(
        spec: &EngineSpec,
        forwards: &[(IpAddr, u16, u16)],
        on_signal: impl Fn(EngineSignal) + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let config = build_config(spec, forwards);

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .thread_name("servera-wireguard")
            .build()
            .map_err(|e| format!("Failed to start WireGuard runtime: {}", e))?;

        let bus = Bus::new();
        // Subscribe before start_tunnels so no early event is missed.
        let mut endpoint = bus.new_endpoint();

        // start_tunnels completes as soon as its tasks are spawned; wait for
        // its result (UDP bind / peer init errors) over a sync channel since
        // this fn may itself be called from an async context.
        let (tx, rx) = std::sync::mpsc::channel();
        runtime.spawn(async move {
            let _ = tx.send(onetun::start_tunnels(config, bus).await);
        });
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Timed out starting WireGuard tunnel".to_string())?
            .map_err(|e| format!("Failed to start WireGuard tunnel: {}", e))?;

        runtime.spawn(async move {
            let mut first_client: Option<Instant> = None;
            let mut warned = false;
            loop {
                match tokio::time::timeout(Duration::from_secs(2), endpoint.recv()).await {
                    Ok(Event::InboundInternetPacket(..)) => {
                        on_signal(EngineSignal::Active);
                        return;
                    }
                    Ok(Event::ClientConnectionInitiated(..)) => {
                        first_client.get_or_insert_with(Instant::now);
                    }
                    Ok(_) => {}
                    Err(_) => {}
                }
                if !warned
                    && first_client
                        .map(|t| t.elapsed() > Duration::from_secs(10))
                        .unwrap_or(false)
                {
                    on_signal(EngineSignal::NoTraffic);
                    warned = true;
                }
            }
        });

        Ok(Self {
            runtime: Some(runtime),
        })
    }
}

fn build_config(spec: &EngineSpec, forwards: &[(IpAddr, u16, u16)]) -> Config {
    let port_forwards = forwards
        .iter()
        .map(|(target_ip, target_port, local_port)| PortForwardConfig {
            source: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), *local_port),
            destination: SocketAddr::new(*target_ip, *target_port),
            protocol: PortProtocol::Tcp,
            remote: false,
        })
        .collect();

    let endpoint_bind_addr: SocketAddr = if spec.endpoint_addr.is_ipv4() {
        "0.0.0.0:0".parse().unwrap()
    } else {
        "[::]:0".parse().unwrap()
    };

    Config {
        port_forwards,
        remote_port_forwards: Vec::new(),
        private_key: Arc::new(StaticSecret::from(spec.private_key)),
        endpoint_public_key: Arc::new(PublicKey::from(spec.peer_public_key)),
        preshared_key: spec.preshared_key,
        endpoint_addr: spec.endpoint_addr,
        endpoint_bind_addr,
        source_peer_ip: spec.source_peer_ip,
        keepalive_seconds: spec.keepalive,
        max_transmission_unit: spec.mtu,
        log: String::new(),
        warnings: Vec::new(),
        pcap_file: None,
    }
}

/// Decodes a base64 WireGuard key (private, public, or preshared).
pub fn decode_key_b64(s: &str) -> Result<[u8; 32], String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|e| format!("Invalid base64 WireGuard key: {}", e))?;
    bytes
        .try_into()
        .map_err(|_| "WireGuard key must decode to exactly 32 bytes".to_string())
}

/// Grabs a free loopback port by binding to port 0 and releasing it.
/// A small race window exists before onetun re-binds; callers retry once.
pub fn alloc_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("Failed to allocate local port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read allocated port: {}", e))?
        .port();
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_key_roundtrip() {
        let key = base64::engine::general_purpose::STANDARD.encode([7u8; 32]);
        assert_eq!(decode_key_b64(&key).unwrap(), [7u8; 32]);
    }

    #[test]
    fn decode_key_rejects_bad_input() {
        assert!(decode_key_b64("not base64!!!").is_err());
        let short = base64::engine::general_purpose::STANDARD.encode([1u8; 16]);
        assert!(decode_key_b64(&short).is_err());
    }

    #[test]
    fn alloc_port_returns_nonzero() {
        assert!(alloc_loopback_port().unwrap() > 0);
    }
}
