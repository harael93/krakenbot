const ApiStatus = ({ status, onRetry }) => {
  const getStatusInfo = () => {
    switch (status) {
      case 'connected':
        return {
          icon: '🟢',
          text: 'API Connected',
          className: 'status-connected',
          showRetry: false
        }
      case 'checking':
        return {
          icon: '🟡',
          text: 'Checking API...',
          className: 'status-checking',
          showRetry: false
        }
      case 'error':
        return {
          icon: '🔴',
          text: 'API Disconnected',
          className: 'status-error',
          showRetry: true
        }
      default:
        return {
          icon: '⚪',
          text: 'Unknown Status',
          className: 'status-unknown',
          showRetry: true
        }
    }
  }

  const statusInfo = getStatusInfo()

  return (
    <div className={`api-status ${statusInfo.className}`}>
      <div className="status-content">
        <span className="status-icon">{statusInfo.icon}</span>
        <span className="status-text">{statusInfo.text}</span>
        {statusInfo.showRetry && (
          <button 
            onClick={onRetry} 
            className="retry-button"
            title="Retry connection"
          >
            🔄 Retry
          </button>
        )}
      </div>
      
      {status === 'error' && (
        <div className="status-help">
          <p>Make sure the FastAPI server is running:</p>
          <code>cd server && python main.py</code>
        </div>
      )}
    </div>
  )
}

export default ApiStatus