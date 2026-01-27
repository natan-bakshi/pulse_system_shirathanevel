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
}

export const pagesConfig = {
    mainPage: "AdminDashboard",
    Pages: PAGES,
    Layout: __Layout,
};