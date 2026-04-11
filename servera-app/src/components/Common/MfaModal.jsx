import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Shield, Key, ChevronRight, AlertCircle, X } from 'lucide-react';

const MfaModal = () => {
    const [activeMfa, setActiveMfa] = useState(null);
    const [responses, setResponses] = useState([]);
    const [error, setError] = useState('');

    useEffect(() => {
        const unlisten = listen('mfa-requested', (event) => {
            const { session_id, name, instruction, prompts } = event.payload;
            setActiveMfa({ session_id, name, instruction, prompts });
            setResponses(new Array(prompts.length).fill(''));
            setError('');
        });

        return () => {
            unlisten.then(u => u());
        };
    }, []);

    const handleChange = (index, value) => {
        const newResponses = [...responses];
        newResponses[index] = value;
        setResponses(newResponses);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const success = await invoke('resolve_mfa_response', { 
                sessionId: activeMfa.session_id, 
                responses 
            });
            if (success) {
                setActiveMfa(null);
            } else {
                setError('Failed to send response to backend.');
            }
        } catch (err) {
            setError(err.toString());
        }
    };

    if (!activeMfa) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div className="w-full max-w-md bg-[#0F0F0F] rounded-2xl border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/30">
                            <Shield className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white leading-none mb-1">
                                {activeMfa.name || 'Security Verification'}
                            </h2>
                            <p className="text-xs text-white/40 uppercase tracking-widest font-semibold">
                                Multi-Factor Authentication
                            </p>
                        </div>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
                        <p className="text-sm text-white/70 italic text-center">
                            {activeMfa.instruction || 'Please provide the requested authentication info.'}
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {activeMfa.prompts.map((prompt, index) => (
                            <div key={index} className="space-y-2">
                                <label className="text-sm font-medium text-white/60 ml-1">
                                    {prompt.text}
                                </label>
                                <div className="relative group">
                                    <input
                                        type={prompt.echo ? 'text' : 'password'}
                                        value={responses[index]}
                                        onChange={(e) => handleChange(index, e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all"
                                        placeholder={prompt.text.includes('code') ? 'Enter code...' : 'Type here...'}
                                        required
                                        autoFocus={index === 0}
                                    />
                                    <Key className="absolute right-4 top-3.5 w-4 h-4 text-white/20 group-focus-within:text-blue-400/50 transition-colors" />
                                </div>
                            </div>
                        ))}

                        {error && (
                            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                <p>{error}</p>
                            </div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setActiveMfa(null)}
                                className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-all border border-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 group"
                            >
                                Verify 
                                <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                            </button>
                        </div>
                    </form>
                </div>

                <div className="px-6 py-4 bg-white/5 border-t border-white/10 flex items-center justify-between">
                    <p className="text-[10px] text-white/30 uppercase tracking-tighter">
                        Protected by Servera Enterprise Auth
                    </p>
                    <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50 animate-pulse"></div>
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50 animate-pulse delay-75"></div>
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50 animate-pulse delay-150"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MfaModal;
