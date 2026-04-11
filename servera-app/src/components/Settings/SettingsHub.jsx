import { useState } from 'react';
import { Settings2, Cpu, Key, Clock, ListTree, Database, Download } from 'lucide-react';
import AppConfig from './Panels/AppConfig';
import SSHKeys from './Panels/SSHKeys';
import CronJobs from './Panels/CronJobs';
import ServiceManager from './Panels/ServiceManager';
import EnvManager from './Panels/EnvManager';
import ImportProfiles from './Panels/ImportProfiles';
import SidebarCustomizer from './Panels/SidebarCustomizer';
import './SettingsHub.css';

const TABS = [
    { id: 'app', label: 'App & AI Config', icon: Settings2, component: AppConfig },
    { id: 'sidebar', label: 'Sidebar Layout', icon: ListTree, component: SidebarCustomizer },
    { id: 'ssh', label: 'SSH Keys', icon: Key, component: SSHKeys },
    { id: 'cron', label: 'Cron Jobs', icon: Clock, component: CronJobs },
    { id: 'services', label: 'Services', icon: Cpu, component: ServiceManager },
    { id: 'env', label: 'Environment', icon: Database, component: EnvManager },
    { id: 'import', label: 'Import Profiles', icon: Download, component: ImportProfiles },
];

export default function SettingsHub({ sidebarItems, setSidebarItems }) {
    const [activeTab, setActiveTab] = useState('app');

    const ActiveComponent = TABS.find(t => t.id === activeTab)?.component || AppConfig;

    return (
        <div className="sh-container">
            <div className="sh-sidebar">
                <div className="sh-header">
                    <h2>Settings & Tools</h2>
                </div>
                <div className="sh-nav">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                className={`sh-nav-btn ${activeTab === tab.id ? 'active' : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                <Icon size={16} />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
            <div className="sh-content">
                <ActiveComponent sidebarItems={sidebarItems} setSidebarItems={setSidebarItems} />
            </div>
        </div>
    );
}
