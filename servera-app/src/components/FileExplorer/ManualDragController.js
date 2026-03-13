/**
 * ManualDragController
 * Handles WinSCP-style drag and drop without using the HTML5 DnD API.
 * Dispatches 'manual-drop' on document so all panes can listen.
 */
class ManualDragController {
    constructor() {
        this.isDragging = false;
        this.dragData = null; // { mode, path, name, isDir }
        this.ghost = null;
        this.startX = 0;
        this.startY = 0;
        this.threshold = 5; // pixels before drag starts
        this.currentHighlight = null;
        this.onDropCallback = null;
        this.scrollInterval = null;
        this.sourceElement = null;
        this._initialized = false;
    }

    init() {
        if (typeof document === 'undefined') return;
        if (this._initialized) return;

        // Remove stale ghost if it exists (e.g. from hot-reload)
        const existing = document.getElementById('manual-drag-ghost');
        if (existing) existing.remove();

        this.ghost = document.createElement('div');
        this.ghost.id = 'manual-drag-ghost';
        this.ghost.className = 'manual-drag-ghost';
        this.ghost.style.position = 'fixed';
        this.ghost.style.display = 'none';
        this.ghost.style.pointerEvents = 'none';
        this.ghost.style.zIndex = '99999';
        document.body.appendChild(this.ghost);
        this._initialized = true;
    }

    /** Ensure ghost element exists before every drag */
    _ensureGhost() {
        if (!this.ghost || !document.body.contains(this.ghost)) {
            this._initialized = false;
            this.init();
        }
    }

    start(e, data, onDrop) {
        if (e.button !== 0) return; // Left click only

        this.startX = e.clientX;
        this.startY = e.clientY;
        this.dragData = data;
        this.onDropCallback = onDrop;
        this.sourceElement = e.currentTarget;

        const moveInitial = (me) => {
            const dist = Math.sqrt(Math.pow(me.clientX - this.startX, 2) + Math.pow(me.clientY - this.startY, 2));
            if (dist > this.threshold) {
                window.removeEventListener('mousemove', moveInitial);
                window.removeEventListener('mouseup', upInitial);
                this.beginDrag(me);
            }
        };

        const upInitial = () => {
            window.removeEventListener('mousemove', moveInitial);
            window.removeEventListener('mouseup', upInitial);
        };

        window.addEventListener('mousemove', moveInitial);
        window.addEventListener('mouseup', upInitial);
    }

    beginDrag(e) {
        this.isDragging = true;
        document.body.classList.add('dnd-active');

        // Dim the source element
        if (this.sourceElement) {
            this.sourceElement.classList.add('dragging');
        }

        this._ensureGhost();
        this.ghost.style.display = 'flex';

        // Premium Ghost Structure
        const iconPath = this.dragData.isDir
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="#FCD34D" stroke="#F59E0B" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';

        this.ghost.innerHTML = `
            <span class="ghost-icon">${iconPath}</span>
            <span class="ghost-name">${this.dragData.name}</span>
        `;

        this.ghost.style.left = `${e.clientX + 10}px`;
        this.ghost.style.top = `${e.clientY + 10}px`;

        window.addEventListener('mousemove', this.handleMove);
        window.addEventListener('mouseup', this.handleUp);
    }

    handleMove = (e) => {
        if (!this.isDragging) return;

        // 1. Move Ghost
        this.ghost.style.left = `${e.clientX + 10}px`;
        this.ghost.style.top = `${e.clientY + 10}px`;

        // 2. Hit Testing — temporarily hide ghost to get elements beneath
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        const folderTarget = elements.find(el => el.classList.contains('file-item') && el.getAttribute('data-is-dir') === 'true');
        const listTarget = elements.find(el => el.classList.contains('file-list'));

        // 3. Highlighting
        if (this.currentHighlight && this.currentHighlight !== folderTarget) {
            this.currentHighlight.classList.remove('drop-folder-manual');
        }

        if (folderTarget) {
            folderTarget.classList.add('drop-folder-manual');
            this.currentHighlight = folderTarget;
        } else {
            this.currentHighlight = null;
        }

        // 4. Auto Scroll
        this.handleAutoScroll(e, listTarget);
    };

    handleAutoScroll(e, list) {
        if (!list) {
            this.stopScroll();
            return;
        }

        const rect = list.getBoundingClientRect();
        const threshold = 50;
        const topDist = e.clientY - rect.top;
        const bottomDist = rect.bottom - e.clientY;

        if (topDist < threshold) {
            this.startScroll(list, -1, (threshold - topDist) / 2);
        } else if (bottomDist < threshold) {
            this.startScroll(list, 1, (threshold - bottomDist) / 2);
        } else {
            this.stopScroll();
        }
    }

    startScroll(list, dir, speed) {
        this.stopScroll();
        this.scrollInterval = setInterval(() => {
            list.scrollTop += dir * speed;
        }, 16);
    }

    stopScroll() {
        if (this.scrollInterval) {
            clearInterval(this.scrollInterval);
            this.scrollInterval = null;
        }
    }

    handleUp = (e) => {
        this.isDragging = false;
        this.stopScroll();
        document.body.classList.remove('dnd-active');
        if (this.ghost) this.ghost.style.display = 'none';

        // Remove source dimming
        if (this.sourceElement) {
            this.sourceElement.classList.remove('dragging');
            this.sourceElement = null;
        }

        window.removeEventListener('mousemove', this.handleMove);
        window.removeEventListener('mouseup', this.handleUp);

        if (this.currentHighlight) {
            this.currentHighlight.classList.remove('drop-folder-manual');
        }

        // Resolve Drop
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        const folderTarget = elements.find(el => el.classList.contains('file-item') && el.getAttribute('data-is-dir') === 'true');
        const listTarget = elements.find(el => el.classList.contains('file-list'));

        if (folderTarget || listTarget) {
            const targetEl = folderTarget || listTarget;
            const targetMode = targetEl.getAttribute('data-mode');
            const targetPath = (folderTarget ? folderTarget.getAttribute('data-path') : listTarget.getAttribute('data-current-path'));

            // Dispatch on document so all GenericFileTree instances can listen
            const event = new CustomEvent('manual-drop', {
                detail: {
                    sourceData: this.dragData,
                    targetPath,
                    targetMode
                },
                bubbles: false
            });
            document.dispatchEvent(event);
        }

        this.dragData = null;
    };
}

export const dragController = new ManualDragController();

// Auto-initialize on module load
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => dragController.init());
    } else {
        dragController.init();
    }
}
