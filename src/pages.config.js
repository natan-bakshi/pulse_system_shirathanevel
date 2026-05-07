/**
 * pages.config.js - Page routing configuration
 * 
 * NOTE: Lazy loading enabled for performance optimization.
 * Each page is loaded on-demand via React.lazy + Suspense.
 * The main page (AdminDashboard) is preloaded immediately for instant display.
 */
import { lazy } from 'react';
import AdminDashboard from './pages/AdminDashboard';
import __Layout from './Layout.jsx';

// Lazy-loaded pages (loaded only when navigated to)
const ClientDashboard = lazy(() => import('./pages/ClientDashboard'));
const ClientGallery = lazy(() => import('./pages/ClientGallery'));
const ClientManagement = lazy(() => import('./pages/ClientManagement'));
const EventDetails = lazy(() => import('./pages/EventDetails'));
const EventManagement = lazy(() => import('./pages/EventManagement'));
const EventsBoardPage = lazy(() => import('./pages/EventsBoardPage'));
const ManualQuoteEditor = lazy(() => import('./pages/ManualQuoteEditor'));
const MyNotificationSettings = lazy(() => import('./pages/MyNotificationSettings'));
const MyTasks = lazy(() => import('./pages/MyTasks'));
const QuoteTemplateManagement = lazy(() => import('./pages/QuoteTemplateManagement'));
const ServiceManagement = lazy(() => import('./pages/ServiceManagement'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SupplierCalendarDashboard = lazy(() => import('./pages/SupplierCalendarDashboard'));
const SupplierDashboard = lazy(() => import('./pages/SupplierDashboard'));
const SupplierManagement = lazy(() => import('./pages/SupplierManagement'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const UserSettings = lazy(() => import('./pages/UserSettings'));


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