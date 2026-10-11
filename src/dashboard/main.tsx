import { createRoot } from 'react-dom/client';
import { Dashboard } from './Dashboard';
import '../ui/global.css';
import '../ui/touchview-dashboard.css';
import '../ui/handfree-theme.css';
import '../ui/reference-polish.css';

createRoot(document.getElementById('root')!).render(<Dashboard />);
