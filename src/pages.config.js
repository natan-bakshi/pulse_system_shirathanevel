/**
 * pages.config.js - Page routing configuration
 * 
 * NOTE: Lazy loading enabled for performance optimization.
 * Each page is loaded on-demand via React.lazy + Suspense.
 * The main page (AdminDashboard) is preloaded immediately for instant display.
 *
 * Smart prefetching: After initial paint (idle time), we preload the most-visited
 * pages so navigation between dashboards feels instant — no Suspense fallback delay.
 */
import { lazy } from 'react';
import AdminDashboard from './pages/AdminDashboard';
import __Layout from './Layout.jsx';

// Helper: create a lazy import that caches the dynamic-import promise so we can
// preload it during idle time without re-importing later.
const lazyWithPreload = (factory) => {
  let promise = null;
  const load = () => {
    if (!promise) promise = factory();
    return promise;
  };
  const Component = lazy(load);
  Component.preload = load;
  return Component;
};

// Lazy-loaded pages (loaded only when navigated to, with optional preload)
const ClientDashboard = lazyWithPreload(() => import('./pages/ClientDashboard'));
const ClientGallery = lazyWithPreload(() => import('./pages/ClientGallery'));
const ClientManagement = lazyWithPreload(() => import('./pages/ClientManagement'));
const EventDetails = lazyWithPreload(() => import('./pages/EventDetails'));
const EventManagement = lazyWithPreload(() => import('./pages/EventManagement'));
const EventsBoardPage = lazyWithPreload(() => import('./pages/EventsBoardPage'));
const ManualQuoteEditor = lazyWithPreload(() => import('./pages/ManualQuoteEditor'));
const MyNotificationSettings = lazyWithPreload(() => import('./pages/MyNotificationSettings'));
const MyTasks = lazyWithPreload(() => import('./pages/MyTasks'));
const QuoteTemplateManagement = lazyWithPreload(() => import('./pages/QuoteTemplateManagement'));
const ServiceManagement = lazyWithPreload(() => import('./pages/ServiceManagement'));
const SettingsPage = lazyWithPreload(() => import('./pages/SettingsPage'));
const SupplierCalendarDashboard = lazyWithPreload(() => import('./pages/SupplierCalendarDashboard'));
const SupplierDashboard = lazyWithPreload(() => import('./pages/SupplierDashboard'));
const SupplierManagement = lazyWithPreload(() => import('./pages/SupplierManagement'));
const UserManagement = lazyWithPreload(() => import('./pages/UserManagement'));
const UserSettings = lazyWithPreload(() => import('./pages/UserSettings'));

// Preload high-traffic pages during browser idle time after initial paint.
// This makes navigation between major sections instant (no Suspense fallback).
// Runs only once per page-load, in the background, with low priority.
if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 2000));
  idle(() => {
    // Most commonly navigated pages from any dashboard
    EventManagement.preload();
    EventsBoardPage.preload();
    EventDetails.preload();
    ClientDashboard.preload();
    SupplierDashboard.preload();
    SupplierCalendarDashboard.preload();
    UserSettings.preload();
  }, { timeout: 5000 });
}


export const PAGES = {
    "AdminDashboard": AdminDashboard,
    "ClientDashboard": ClientDashboard,
    "ClientGallery": ClientGallery,
    "ClientManagement": ClientManagement,
    "EventDetails": EventDetails,
    "EventManagement": EventManagement,
    "EventsBoardPage": EventsBoardPage,
    "ManualQuoteEditor": ManualQuoteEditor,
    "MyNotificationSettings": MyNotificationSettings,
    "MyTasks": MyTasks,
    "QuoteTemplateManagement": QuoteTemplateManagement,
    "ServiceManagement": ServiceManagement,
    "SettingsPage": SettingsPage,
    "SupplierCalendarDashboard": SupplierCalendarDashboard,
    "SupplierDashboard": SupplierDashboard,
    "SupplierManagement": SupplierManagement,
    "UserManagement": UserManagement,
    "UserSettings": UserSettings,
}

export const pagesConfig = {
    mainPage: "AdminDashboard",
    Pages: PAGES,
    Layout: __Layout,
};