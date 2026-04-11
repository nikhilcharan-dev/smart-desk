import ImportWizard from "../../Onboarding/ImportWizard";

export default function ImportProfiles() {
    return (
        <div className="sh-panel">
            <div className="sh-panel-header">
                <div>
                    <h2>Import SSH Profiles</h2>
                    <p className="sh-panel-subtitle">Import your existing server configurations from ~/.ssh/config</p>
                </div>
            </div>
            
            <div className="sh-card" style={{ padding: 0 }}>
                <ImportWizard onComplete={() => window.location.reload()} onCancel={() => {}} />
            </div>
        </div>
    );
}
