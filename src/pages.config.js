/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AdminDashboard from './pages/AdminDashboard';
import ClientDashboard from './pages/ClientDashboard';
import ClientGallery from './pages/ClientGallery';
import ClientManagement from './pages/ClientManagement';
import EventDetails from './pages/EventDetails';
import EventManagement from './pages/EventManagement';
import QuoteTemplateManagement from './pages/QuoteTemplateManagement';
import ServiceManagement from './pages/ServiceManagement';
import SettingsPage from './pages/SettingsPage';
import SupplierDashboard from './pages/SupplierDashboard';
import SupplierManagement from './pages/SupplierManagement';
import UserManagement from './pages/UserManagement';
import NotificationSettings from './pages/NotificationSettings';
import MyNotificationSettings from './pages/MyNotificationSettings';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AdminDashboard": AdminDashboard,
    "ClientDashboard": ClientDashboard,
    "ClientGallery": ClientGallery,
    "ClientManagement": ClientManagement,
    "EventDetails": EventDetails,
    "EventManagement": EventManagement,
    "QuoteTemplateManagement": QuoteTemplateManagement,
    "ServiceManagement": ServiceManagement,
    "SettingsPage": SettingsPage,
    "SupplierDashboard": SupplierDashboard,
    "SupplierManagement": SupplierManagement,
    "UserManagement": UserManagement,
    "NotificationSettings": NotificationSettings,
    "MyNotificationSettings": MyNotificationSettings,
}

export const pagesConfig = {
    mainPage: "AdminDashboard",
    Pages: PAGES,
    Layout: __Layout,
};