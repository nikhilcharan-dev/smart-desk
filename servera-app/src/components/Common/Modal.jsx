import { useRef, useEffect } from "react";
import "./Modal.css";

export default function Modal({
    isOpen,
    title,
    children,
    onConfirm,
    onCancel,
    confirmText = "Confirm",
    cancelText = "Cancel",
    type = "prompt",
    inputValue = "",
    setInputValue,
    actions = null // [{ label, onClick, className }]
}) {
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen && type === "prompt" && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isOpen, type]);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (onConfirm) onConfirm();
    };

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content glass" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{title}</h3>
                </div>
                <form onSubmit={handleSubmit} className="modal-body">
                    {type === "prompt" && (
                        <input
                            ref={inputRef}
                            className="modal-input"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            autoFocus
                        />
                    )}
                    {type === "confirm" && (
                        <div className="modal-message">{children}</div>
                    )}
                    {type !== "prompt" && type !== "confirm" && (
                        <div className="modal-custom-content">{children}</div>
                    )}

                    <div className="modal-actions">
                        {actions ? (
                            actions.map((act, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    className={`modal-btn ${act.className || 'secondary'}`}
                                    onClick={() => {
                                        act.onClick();
                                    }}
                                >
                                    {act.label}
                                </button>
                            ))
                        ) : (
                            <>
                                <button type="button" className="modal-btn secondary" onClick={onCancel}>
                                    {cancelText}
                                </button>
                                <button type="submit" className="modal-btn primary">
                                    {confirmText}
                                </button>
                            </>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
}
