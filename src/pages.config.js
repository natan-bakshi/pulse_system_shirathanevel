import AdminDashboard from './pages/AdminDashboard';
import EventManagement from './pages/EventManagement';
import ClientDashboard from './pages/ClientDashboard';
import ClientGallery from './pages/ClientGallery';
import UserManagement from './pages/UserManagement';
import EventDetails from './pages/EventDetails';
import SupplierManagement from './pages/SupplierManagement';
import ServiceManagement from './pages/ServiceManagement';
import ClientManagement from './pages/ClientManagement';
import SettingsPage from './pages/SettingsPage';
import SupplierDashboard from './pages/SupplierDashboard';
import QuoteTemplateManagement from './pages/QuoteTemplateManagement';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AdminDashboard": AdminDashboard,
    "EventManagement": EventManagement,
    "ClientDashboard": ClientDashboard,
    "ClientGallery": ClientGallery,
    "UserManagement": UserManagement,
    "EventDetails": EventDetails,
    "SupplierManagement": SupplierManagement,
    "ServiceManagement": ServiceManagement,
    "ClientManagement": ClientManagement,
    "SettingsPage": SettingsPage,
    "SupplierDashboard": SupplierDashboard,
    "QuoteTemplateManagement": QuoteTemplateManagement,
}

export const pagesConfig = {
    mainPage: "AdminDashboard",
    Pages: PAGES,
    Layout: __Layout,
};