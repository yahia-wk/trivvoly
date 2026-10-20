import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import './styles/tokens.css';

// Each screen loads only what it needs: phones never download the TV's sound engine.
const Landing = lazy(() => import('./pages/landing/Landing'));
const Play = lazy(() => import('./pages/play/Play'));
const Remote = lazy(() => import('./pages/remote/Remote'));
const Show = lazy(() => import('./pages/show/Show'));
const Build = lazy(() => import('./pages/build/Build'));

const page = (el: React.ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: '/', element: page(<Landing />) },
  { path: '/build', element: page(<Build />) },
  { path: '/r/:code', element: page(<Play />) },
  { path: '/r/:code/host', element: page(<Show />) },
  { path: '/r/:code/remote', element: page(<Remote />) },
  { path: '*', element: <Navigate to="/" replace /> }
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
