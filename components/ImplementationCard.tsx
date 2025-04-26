import React from 'react';

interface Implementation {
  id: string;
  name: string;
  description: string;
  status: 'implemented' | 'planned';
  estimate?: string;
  codeUrl?: string;
}

interface Result {
  totalEth: string;
  holderCount: number;
  sampledHolders?: number;
  block?: number;
  blockNumber?: number;
  executionTime: number;
  implementationNotes?: string;
  isMock?: boolean;
}

interface ImplementationCardProps {
  implementation: Implementation;
  result?: Result | null;
  loading: boolean;
  error?: string | null;
  onRun: (implementation: Implementation) => void;
}

const ImplementationCard: React.FC<ImplementationCardProps> = ({ 
  implementation, 
  result, 
  loading, 
  error, 
  onRun 
}) => {
  const isImplemented = implementation.status === 'implemented';
  const isMock = result?.isMock;
  
  return (
    <div className={`implementation-card ${isImplemented ? 'implemented' : 'planned'}`}>
      <div className="card-header">
        <h3>{implementation.name}</h3>
        {isImplemented ? (
          <span className="badge badge-primary">Implemented</span>
        ) : (
          <span className="badge badge-warning">Planned</span>
        )}
      </div>
      
      <p className="description">{implementation.description}</p>
      
      {implementation.status === 'planned' && implementation.estimate && (
        <div className="estimate">
          <span className="estimate-label">Estimated Performance:</span>
          <span className="estimate-value">{implementation.estimate}</span>
        </div>
      )}
      
      <div className="card-actions">
        <button 
          onClick={() => onRun(implementation)}
          disabled={loading}
          className={isImplemented ? 'btn-primary' : 'btn-secondary'}
        >
          {loading ? (
            <>
              <span className="spinner"></span>
              <span>Running...</span>
            </>
          ) : (
            'Run'
          )}
        </button>
        {isImplemented && (
          <a
            href={implementation.codeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-code"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="code-icon">
              <path fillRule="evenodd" d="M6.28 5.22a.75.75 0 010 1.06L2.56 10l3.72 3.72a.75.75 0 01-1.06 1.06L.97 10.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0zm7.44 0a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L17.44 10l-3.72-3.72a.75.75 0 010-1.06zM11.377 2.011a.75.75 0 01.612.867l-2.5 14.5a.75.75 0 01-1.478-.255l2.5-14.5a.75.75 0 01.866-.612z" clipRule="evenodd" />
            </svg>
            View Code
          </a>
        )}
      </div>
      
      {error && (
        <div className="error-message">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="error-icon">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          {error}
        </div>
      )}
      
      {result && (
        <div className="result">
          <div className="result-header">
            <h4>Results</h4>
            {isMock && (
              <span className="badge badge-warning">Mock</span>
            )}
          </div>
          
          <div className="result-grid">
            <div className="result-item">
              <span className="result-label">Total ETH</span>
              <span className="result-value">{parseFloat(result.totalEth).toLocaleString()} ETH</span>
            </div>
            
            <div className="result-item">
              <span className="result-label">Holders</span>
              <span className="result-value">{result.holderCount.toLocaleString()}</span>
            </div>
            
            <div className="result-item">
              <span className="result-label">Sampled</span>
              <span className="result-value">{result.sampledHolders ? result.sampledHolders.toLocaleString() : result.holderCount.toLocaleString()}</span>
            </div>
            
            <div className="result-item">
              <span className="result-label">Block</span>
              <span className="result-value">{result.block ? result.block.toLocaleString() : (result.blockNumber ? result.blockNumber.toLocaleString() : 'N/A')}</span>
            </div>
            
            <div className="result-item execution-time">
              <span className="result-label">Execution Time</span>
              <span className="result-value">{(result.executionTime / 1000).toFixed(2)}s</span>
            </div>
          </div>
          
          {result.implementationNotes && (
            <details className="implementation-notes">
              <summary>Implementation Details</summary>
              <div className="notes-content">
                {result.implementationNotes}
              </div>
            </details>
          )}
        </div>
      )}
      
      <style jsx>{`
        .implementation-card {
          background-color: var(--card-bg);
          border-radius: var(--border-radius);
          overflow: hidden;
          box-shadow: var(--shadow);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .implementation-card:hover {
          transform: translateY(-4px);
          box-shadow: var(--shadow-md);
          background-color: var(--card-bg-hover);
        }
        
        .implementation-card.implemented {
          border-top: 4px solid var(--primary);
        }
        
        .implementation-card.planned {
          border-top: 4px solid var(--warning);
        }
        
        .card-header {
          padding: 1.5rem 1.5rem 0;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        
        .card-header h3 {
          margin: 0;
          font-size: 1.25rem;
          color: var(--foreground);
        }
        
        .description {
          padding: 0.75rem 1.5rem;
          color: var(--gray-600);
          font-size: 0.875rem;
          margin: 0;
        }
        
        .estimate {
          padding: 0 1.5rem;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .estimate-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--gray-600);
        }
        
        .estimate-value {
          font-size: 0.875rem;
          color: var(--warning);
          font-weight: 600;
        }
        
        .card-actions {
          padding: 1rem 1.5rem;
          display: flex;
          justify-content: flex-start;
          gap: 0.5rem;
        }
        
        .btn-primary {
          background-color: var(--primary);
          color: white;
          border: none;
          border-radius: var(--border-radius);
          padding: 0.5rem 1.25rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .btn-secondary {
          background-color: var(--warning);
          color: var(--gray-800);
          border: none;
          border-radius: var(--border-radius);
          padding: 0.5rem 1.25rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .btn-primary:hover, .btn-secondary:hover {
          opacity: 0.9;
        }
        
        .btn-primary:disabled, .btn-secondary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .spinner {
          width: 1rem;
          height: 1rem;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        .error-message {
          margin: 0 1.5rem 1.5rem;
          padding: 0.75rem;
          background-color: rgba(230, 57, 70, 0.15);
          border-radius: var(--border-radius);
          color: var(--danger);
          font-size: 0.875rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .error-icon {
          width: 1rem;
          height: 1rem;
          flex-shrink: 0;
        }
        
        .result {
          margin: 0 1.5rem 1.5rem;
          padding: 1rem;
          background-color: var(--gray-100);
          border-radius: var(--border-radius);
        }
        
        .result-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }
        
        .result-header h4 {
          margin: 0;
          font-size: 1rem;
          color: var(--gray-800);
        }
        
        .badge {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
        }
        
        .badge-primary {
          background-color: var(--primary);
          color: white;
        }
        
        .badge-warning {
          background-color: var(--warning);
          color: var(--gray-800);
        }
        
        .result-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem;
        }
        
        .result-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        
        .execution-time {
          grid-column: span 2;
        }
        
        .result-label {
          font-size: 0.75rem;
          color: var(--gray-600);
          font-weight: 500;
        }
        
        .result-value {
          font-size: 0.875rem;
          color: var(--gray-800);
          font-weight: 600;
        }
        
        .implementation-notes {
          margin-top: 1rem;
          font-size: 0.875rem;
        }
        
        .implementation-notes summary {
          color: var(--primary);
          cursor: pointer;
          font-weight: 500;
        }
        
        .notes-content {
          margin-top: 0.5rem;
          padding: 0.75rem;
          background-color: var(--gray-50);
          border-radius: var(--border-radius);
          color: var(--gray-700);
        }
        
        .code-icon {
          width: 1rem;
          height: 1rem;
          margin-right: 0.5rem;
        }
        
        .btn-code {
          background-color: var(--gray-100);
          color: var(--gray-800);
          border: 1px solid var(--gray-300);
          border-radius: var(--border-radius);
          padding: 0.5rem 1.25rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          text-decoration: none;
          transition: all 0.2s ease;
        }
        
        .btn-code:hover {
          background-color: var(--gray-200);
          border-color: var(--gray-400);
        }
      `}</style>
    </div>
  );
};

export default ImplementationCard; 