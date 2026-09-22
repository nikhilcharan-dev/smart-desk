/**
 * Error formatting for failures coming back from the remote host.
 *
 * The Rust side attempts every privileged operation as the login user first and
 * escalates through sudo (`sudo -n`, then the profile's stored password) on its
 * own. By the time an error surfaces here, elevation has already been tried, so
 * the useful question is never "should I retry with sudo?" but "why couldn't
 * sudo finish?". Two backend sentinels answer that, and both are fixable by the
 * user — show those instead of the raw libssh2 text (`[SFTP(3)] permission
 * denied`), which tells them nothing actionable.
 */

const PERMISSION_MARKERS = [
    "sftp(3)",
    "permission denied",
    "operation not permitted",
    "access denied",
    "eacces",
    "eperm",
];

/** Normalize anything throwable (Error, Tauri string, object) to a string. */
const asText = (err) => String(err?.message ?? err ?? "");

/** Did this fail for lack of privileges rather than a genuine error? */
export function isPermissionError(err) {
    const raw = asText(err).toLowerCase();
    return PERMISSION_MARKERS.some((marker) => raw.includes(marker));
}

/** True when the failure was specifically about missing/failed sudo credentials. */
export function isSudoCredentialError(err) {
    const raw = asText(err);
    return raw.includes("SUDO_PASSWORD_REQUIRED") || raw.includes("SUDO_PASSWORD_INCORRECT");
}

/**
 * Turn a remote error into a sentence worth showing a user.
 * `action` names what was attempted, e.g. `Saving /etc/hosts`.
 */
export function formatRemoteError(err, action = "The operation") {
    const raw = asText(err);

    if (raw.includes("SUDO_PASSWORD_REQUIRED")) {
        return `${action} needs root, and this server requires a password for sudo. Add a sudo password to this profile (Edit profile → Sudo password) and reconnect.`;
    }
    if (raw.includes("SUDO_PASSWORD_INCORRECT")) {
        return `${action} needs root, but the stored sudo password was rejected. Update it in this profile's settings (Edit profile → Sudo password).`;
    }
    if (isPermissionError(raw)) {
        return `${action} failed: permission denied, and sudo could not complete it either. Check that this account is allowed to use sudo for this path.`;
    }
    return `${action} failed: ${raw}`;
}
