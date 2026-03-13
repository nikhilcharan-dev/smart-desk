import { useRef, useEffect } from "react";
import { Edit2, Trash2, Archive, BoxSelect, FolderPlus, FilePlus, Download, Shield } from "lucide-react";

export default function FileContextMenu({ x, y, file, isRemote, onRename, onDelete, onZip, onUnzip, onCreate, onDownload, onPermissions, onClose }) {
    const menuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [onClose]);

    // Prevent menu from going off-screen
    const style = {
        top: y,
        left: x,
    };

    if (x > window.innerWidth - 180) style.left = x - 180;
    if (y > window.innerHeight - 200) style.top = y - 200;

    const isZip = file?.name?.endsWith('.zip');

    return (
        <div className="context-menu" ref={menuRef} style={style}>
            {!file && (
                <>
                    <div className="context-menu-item" onClick={() => onCreate('folder')}>
                        <FolderPlus size={14} /> New Folder
                    </div>
                    <div className="context-menu-item" onClick={() => onCreate('file')}>
                        <FilePlus size={14} /> New File
                    </div>
                </>
            )}

            {file && (
                <>
                    <div className="context-menu-item" onClick={() => onRename(file)}>
                        <Edit2 size={14} /> Rename
                    </div>

                    {isRemote && (
                        <div className="context-menu-item" onClick={() => onDownload(file)}>
                            <Download size={14} /> Download to Local
                        </div>
                    )}

                    <div className="context-menu-item" onClick={() => onZip(file)}>
                        <Archive size={14} /> Compress (Zip)
                    </div>

                    {isZip && (
                        <div className="context-menu-item" onClick={() => onUnzip(file)}>
                            <BoxSelect size={14} /> Extract Here
                        </div>
                    )}

                    {isRemote && (
                        <div className="context-menu-item" onClick={() => onPermissions(file)}>
                            <Shield size={14} /> Permissions
                        </div>
                    )}

                    <div className="context-menu-divisor" style={{ height: 1, background: '#374151', margin: '4px 0' }}></div>

                    <div className="context-menu-item danger" onClick={() => onDelete(file)}>
                        <Trash2 size={14} /> Delete
                    </div>
                </>
            )}
        </div>
    );
}
