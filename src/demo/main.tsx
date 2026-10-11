import { createRoot } from 'react-dom/client';
import { DemoLab } from './DemoLab';
import '../ui/global.css';
import '../ui/demo-focused.css';

createRoot(document.getElementById('root')!).render(<DemoLab />);
