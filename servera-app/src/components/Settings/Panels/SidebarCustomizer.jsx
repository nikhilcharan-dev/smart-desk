import { Check } from 'lucide-react';
import { DEFAULT_SIDEBAR_ITEMS } from '../../../constants';
import './SidebarCustomizer.css';

export default function SidebarCustomizer({ sidebarItems = [], setSidebarItems }) {
    const toggleItem = (id) => {
        if (sidebarItems.includes(id)) {
            // Ensure at least one item remains
            if (sidebarItems.length > 1) {
                setSidebarItems(sidebarItems.filter(i => i !== id));
            }
        } else {
            // Add while preserving original order
            const newItemSet = new Set([...sidebarItems, id]);
            setSidebarItems(DEFAULT_SIDEBAR_ITEMS.map(i => i.id).filter(id => newItemSet.has(id)));
        }
    };

    return (
        <div className="sh-panel">
            <h3 className="sh-panel-title">Sidebar Customizer</h3>
            <p className="sh-panel-desc">Select which tools and views you want pinned to the main sidebar.</p>

            <div className="sb-customizer-grid">
                {DEFAULT_SIDEBAR_ITEMS.map(item => {
                    const IconComp = item.icon;
                    const isActive = sidebarItems.includes(item.id);

                    return (
                        <div
                            key={item.id}
                            className={`sb-toggle-card ${isActive ? 'active' : ''}`}
                            onClick={() => toggleItem(item.id)}
                        >
                            <div className="sb-toggle-icon">
                                <IconComp size={20} />
                            </div>
                            <div className="sb-toggle-info">
                                <h4>{item.label}</h4>
                            </div>
                            <div className={`sb-checkbox ${isActive ? 'checked' : ''}`}>
                                {isActive && <Check size={14} strokeWidth={3} />}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
