import Link from 'next/link';
import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          <div className="logo">
            <Link href="/">
              <span className="logo-text">Bored Ape Holders' ETH Tracker</span>
            </Link>
          </div>
          
          <nav className="nav">
            <Link href="https://github.com/TacitusXI/bayc-eth-sum" target="_blank" rel="noopener noreferrer">
              <span className="nav-link">GitHub</span>
            </Link>
          </nav>
        </div>
      </div>
      
      <style jsx>{`
        .header {
          background-color: var(--card-bg);
          border-bottom: 1px solid var(--border-color);
          box-shadow: var(--shadow-sm);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        
        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 64px;
        }
        
        .logo {
          display: flex;
          align-items: center;
        }
        
        .logo-text {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--foreground);
          cursor: pointer;
          background: linear-gradient(to right, var(--primary), var(--secondary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        
        .nav {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }
        
        .nav-link {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--gray-700);
          cursor: pointer;
        }
        
        .nav-link:hover {
          color: var(--primary);
        }
      `}</style>
    </header>
  );
};

export default Header; 