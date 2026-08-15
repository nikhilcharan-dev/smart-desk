import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { ShieldCheck, ShieldAlert, Fingerprint, ChevronRight } from 'lucide-react';

// Trust-on-first-use prompt for an unrecognized SSH host key. The backend
// blocks the connection thread on `host-key-verify` until the user answers via
// `resolve_host_key_response`. A rejected/closed prompt refuses the connection.
const HostKeyModal = () => {
    const [request, setRequest] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const unlisten = listen('host-key-verify', (event) => {
            const { session_id, host, port, fingerprint, key_type } = event.payload;
            setRequest({ session_id, host, port, fingerprint, key_type });
            setError('');
            setBusy(false);
        });
        return () => { unlisten.then(u => u()); };
    }, []);

    const respond = async (accepted) => {
        if (!request) return;
        setBusy(true);
        try {
            await invoke('resolve_host_key_response', {
                sessionId: request.session_id,
                accepted,
            });
            setRequest(null);
        } catch (err) {
            setError(err.toString());
            setBusy(false);
        }
    };

    if (!request) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div className="w-full max-w-md bg-[#0F0F0F] rounded-2xl border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/30">
                            <ShieldAlert className="w-5 h-5 text-amber-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white leading-none mb-1">
                                Unrecognized Server
                            </h2>
                            <p className="text-xs text-white/40 uppercase tracking-widest font-semibold">
                                Host Key Verification
                            </p>
                        </div>
                    </div>

                    <p className="text-sm text-white/70 mb-4">
                        You're connecting to{' '}
                        <span className="font-semibold text-white">{request.host}:{request.port}</span>{' '}
                        for the first time. Confirm its fingerprint matches the server you
                        expect — accepting a wrong key exposes this session to interception.
                    </p>

                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-5">
                        <div className="flex items-center gap-2 text-white/40 text-[10px] uppercase tracking-widest font-semibold mb-2">
                            <Fingerprint className="w-3.5 h-3.5" />
                            {request.key_type} fingerprint
                        </div>
                        <code className="block text-xs text-amber-200/90 break-all font-mono leading-relaxed">
                            {request.fingerprint}
                        </code>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                            <p>{error}</p>
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => respond(false)}
                            disabled={busy}
                            className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-all border border-white/10 disabled:opacity-50"
                        >
                            Reject
                        </button>
                        <button
                            type="button"
                            onClick={() => respond(true)}
                            disabled={busy}
                            className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 group disabled:opacity-50"
                        >
                            <ShieldCheck className="w-4 h-4" />
                            Trust &amp; Connect
                            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                    </div>
                </div>

                <div className="px-6 py-4 bg-white/5 border-t border-white/10">
                    <p className="text-[10px] text-white/30 uppercase tracking-tighter">
                        The key is remembered — you'll only be asked again if it changes
                    </p>
                </div>
            </div>
        </div>
    );
};

export default HostKeyModal;
