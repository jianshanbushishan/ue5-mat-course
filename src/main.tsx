import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { installHiDpiCanvas } from './lib/hidpiCanvas';

// 让所有实验画布在高分屏上按物理像素渲染，文字线条不再发虚
installHiDpiCanvas();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
