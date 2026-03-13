import React from 'react';
import { RotateCw, AlertTriangle } from 'lucide-react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    handleRestart = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    background: '#050505',
                    color: '#e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 99999,
                    fontFamily: 'Inter, system-ui, sans-serif'
                }}>
                    <div style={{
                        background: '#0f1219',
                        border: '1px solid #2d3748',
                        borderRadius: '12px',
                        padding: '40px',
                        maxWidth: '600px',
                        width: '90%',
                        textAlign: 'center',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
                    }}>
                        <div style={{
                            background: '#3f1c1c',
                            width: '64px',
                            height: '64px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 24px auto'
                        }}>
                            <AlertTriangle size={32} color="#f56565" />
                        </div>

                        <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '16px' }}>Application Error</h2>
                        <p style={{ color: '#a0aec0', marginBottom: '24px', lineHeight: '1.5' }}>
                            Something went wrong and the application could not recover.
                            If this persists, please check the logs.
                        </p>

                        <div style={{
                            background: '#1a202c',
                            padding: '16px',
                            borderRadius: '8px',
                            textAlign: 'left',
                            marginBottom: '24px',
                            border: '1px solid #2d3748',
                            overflow: 'auto',
                            maxHeight: '200px',
                            fontFamily: 'monospace',
                            fontSize: '0.9rem',
                            color: '#f56565'
                        }}>
                            {this.state.error?.toString()}
                            <br />
                            <span style={{ color: '#718096', fontSize: '0.8rem' }}>
                                {this.state.errorInfo?.componentStack?.slice(0, 300)}...
                            </span>
                        </div>

                        <button
                            onClick={this.handleRestart}
                            style={{
                                background: '#3182ce',
                                color: 'white',
                                border: 'none',
                                padding: '12px 24px',
                                borderRadius: '6px',
                                fontSize: '1rem',
                                fontWeight: '500',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'background 0.2s'
                            }}
                            onMouseOver={(e) => e.target.style.background = '#2b6cb0'}
                            onMouseOut={(e) => e.target.style.background = '#3182ce'}
                        >
                            <RotateCw size={18} />
                            Restart Application
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
