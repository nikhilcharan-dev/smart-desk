import {
    LayoutDashboard, FolderOpen, Terminal as TerminalIcon, Monitor,
    Cpu, Network, ScrollText, Code2, Box, Shield, PackageOpen, ShieldCheck
} from "lucide-react";

export const DEFAULT_SIDEBAR_ITEMS = [
    { id: 'dashboard', label: 'Analytics Hub', icon: LayoutDashboard },
    { id: 'files', label: 'File Explorer', icon: FolderOpen },
    { id: 'terminal', label: 'Smart Terminal', icon: TerminalIcon },
    { id: 'termhub', label: 'TermHub', icon: Monitor },
    { id: 'processes', label: 'Process Manager', icon: Cpu },
    { id: 'ports', label: 'Port Scanner', icon: Network },
    { id: 'logs', label: 'Log Viewer', icon: ScrollText },
    { id: 'snippets', label: 'Snippets', icon: Code2 },
    { id: 'docker', label: 'Docker Manager', icon: Box },
    { id: 'ufw', label: 'Firewall (UFW)', icon: Shield },
    { id: 'apt', label: 'System Updates', icon: PackageOpen },
    { id: 'permissions', label: 'Access Control', icon: ShieldCheck }
];
