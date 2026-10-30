import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import VisitorChat from './components/VisitorChat.jsx';
import './styles.css';

const path = window.location.pathname.replace(/\/$/, '') || '/';
const Page = path === '/admin' ? App : VisitorChat;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Page />
  </StrictMode>
);
