import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  Star,
  Truck,
  Home,
  FileText,
  UserCheck,
  ArrowRight,
  Bell } from
"lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import PushNotificationManager from "@/components/notifications/PushNotificationManager";
import NotificationBell from "@/components/notifications/NotificationBell";
import OneSignalInitializer from "@/components/notifications/OneSignalInitializer";
import PushNotificationPrompt from "@/components/notifications/PushNotificationPrompt";
import TermsPopup from "@/components/legal/TermsPopup";
import { Toaster as SonnerToaster } from "sonner";
// import GoogleCalendarConnect from "@/components/calendar/GoogleCalendarConnect";

// System creator email - only this user can access settings
const SYSTEM_CREATOR_EMAIL = 'natib8000@gmail.com';

const getAdminNavItems = (userEmail) => {
  const items = [
    { title: "דשבורד", url: createPageUrl("AdminDashboard"), icon: Home },
    { title: "לוח אירועים", url: createPageUrl("EventManagement") + "?tab=board", icon: Calendar },
    { title: "אירועים", url: createPageUrl("EventManagement"), icon: Calendar },
    { title: "לקוחות", url: createPageUrl("ClientManagement"), icon: Users },
    { title: "ספקים", url: createPageUrl("SupplierManagement"), icon: Truck },
    { title: "שירותים", url: createPageUrl("ServiceManagement"), icon: Star },
    { title: "הצעות מחיר", url: createPageUrl("QuoteTemplateManagement"), icon: FileText },
    { title: "ניהול משתמשים", url: createPageUrl("UserManagement"), icon: UserCheck },
  ];
  
  // Only system creator can see settings
  if (userEmail === SYSTEM_CREATOR_EMAIL) {
    items.push({ title: "הגדרות", url: createPageUrl("SettingsPage"), icon: Settings });
  }
  
  return items;
};

const navigationItems = {

  client: [
  { title: "האירועים שלי", url: createPageUrl("ClientDashboard"), icon: Home }],

  supplier: [
  { title: "האירועים שלי", url: createPageUrl("SupplierDashboard"), icon: Home }]

};

const commonNavItems = [];

export default function Layout({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showCalendarConnect, setShowCalendarConnect] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // React Query for app settings - cached globally
  const { data: appSettings = [] } = useQuery({
    queryKey: ['appSettings'],
    queryFn: async () => {
      try {
        return await base44.entities.AppSettings.list();
      } catch (error) {
        console.warn("Could not load app settings, using fallback", error);
        return [];
      }
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    cacheTime: 30 * 60 * 1000, // 30 minutes
    retry: 1
  });

  // React Query for suppliers - needed for user type assignment
  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => base44.entities.Supplier.list(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000
  });

  // Memoize settings map
  const settingsMap = useMemo(() => {
    return appSettings.reduce((acc, item) => {
      acc[item.setting_key] = item.setting_value;
      return acc;
    }, {});
  }, [appSettings]);

  // Memoize visual settings
  const { backgroundUrl, companyName, companyLogo } = useMemo(() => {
    return {
      backgroundUrl: settingsMap.background_image_url || "https://i.postimg.cc/vHhVvsRQ/01.png",
      companyName: settingsMap.company_name || "Pulse - הלב הפועם של האירוע שלך",
      companyLogo: settingsMap.company_logo_url || "https://i.postimg.cc/KvxTLYHq/02.png"
    };
  }, [settingsMap]);

  // Update document title and favicon when settings change
  useEffect(() => {
    document.title = companyName;

    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = companyLogo;
  }, [companyName, companyLogo]);

  const assignUserType = useCallback(async (userToUpdate) => {
    try {
      const safeSuppliers = Array.isArray(suppliers) ? suppliers : [];

      const normalizePhone = (phone) => {
        if (!phone) return '';
        let p = phone.replace(/[^\d+]/g, ''); // Keep only digits and +
        if (p.startsWith('+972')) p = '0' + p.substring(4);
        if (p.startsWith('972')) p = '0' + p.substring(3);
        if (p.length === 9 && p.startsWith('5')) p = '0' + p; // Add leading 0 if missing for mobile
        return p;
      };

      const userEmail = userToUpdate.email?.toLowerCase().trim();
      const userPhone = normalizePhone(userToUpdate.phone);

      const matchingSupplier = safeSuppliers.find((s) => {
        // Match by email only
        return userEmail && Array.isArray(s.contact_emails) &&
        s.contact_emails.some((email) => email && email.toLowerCase().trim() === userEmail);
      });

      if (matchingSupplier) {
        return "supplier";
      }

      return "client";
    } catch (error) {
      console.error("Error in assignUserType:", error);
      return "client";
    }
  }, [suppliers]);

  useEffect(() => {
    const fetchUser = async () => {
      // Wait for suppliers to load before assigning user type
      if (suppliersLoading) {
        return;
      }

      setLoading(true);
      try {
        let currentUser = await base44.auth.me();

        if (!currentUser.user_type) {
          const newUserType = await assignUserType(currentUser);
          if (newUserType !== currentUser.user_type) {
            await base44.auth.updateMe({ user_type: newUserType });
            currentUser = await base44.auth.me();
          }
        }
        setUser(currentUser);
      } catch (error) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [assignUserType, location.pathname, suppliersLoading]);

  useEffect(() => {
    if (loading) return;
    if (!user) return;

    const userType = user.user_type;
    const { pathname } = location;

    // Define home pages for each user type
    const homePages = {
      admin: createPageUrl("AdminDashboard"),
      client: createPageUrl("ClientDashboard"),
      supplier: createPageUrl("SupplierDashboard")
    };

    const homePage = homePages[userType] || createPageUrl("ClientDashboard");

    // If user is on root path or empty path, redirect to their dashboard
    if (pathname === "/" || pathname === createPageUrl("")) {
      navigate(homePage, { replace: true });
      return;
    }

    // Admin access control
    const adminOnlyPages = [
    "/AdminDashboard", "/EventManagement", "/ClientManagement",
    "/SupplierManagement", "/ServiceManagement", "/QuoteTemplateManagement",
    "/UserManagement"];
    
    // Settings page is only for system creator
    const isAccessingSettingsPage = pathname.includes('SettingsPage');
    if (isAccessingSettingsPage && user.email !== SYSTEM_CREATOR_EMAIL) {
      navigate(homePage, { replace: true });
      return;
    }

    // Allow all users to access MyNotificationSettings
    const isAccessingNotificationSettings = pathname.includes('MyNotificationSettings');

    // Allow system creator to access SettingsPage
    if (isAccessingSettingsPage && user.email === SYSTEM_CREATOR_EMAIL) {
      return; // Allow access, don't redirect
    }

    const isTryingToAccessAdminPage = adminOnlyPages.some((p) => pathname.startsWith(createPageUrl(p.substring(1))));

    if (userType !== 'admin' && isTryingToAccessAdminPage) {
      navigate(homePage, { replace: true });
      return;
    }

    // If user is not on their correct dashboard and trying to access a non-specific page
    // redirect them to their appropriate dashboard
    const isOnCorrectDashboard = pathname.startsWith(homePage);
    const isAccessingSpecificEvent = pathname.includes('EventDetails');

    if (!isOnCorrectDashboard && !isAccessingSpecificEvent && !isTryingToAccessAdminPage && !isAccessingNotificationSettings && !isAccessingSettingsPage) {
      navigate(homePage, { replace: true });
    }

  }, [user, location, navigate, loading]);

  const handleLogout = useCallback(async () => {
    try {
      await base44.auth.logout();
      setUser(null);
      navigate(createPageUrl(""));
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{
        backgroundImage: `url('${backgroundUrl}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed"
      }}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-800"></div>
      </div>);

  }

  if (!user) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center" style={{
        backgroundImage: `url('${backgroundUrl}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed"
      }}>
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl p-8 shadow-2xl text-center">
          <img
            src={companyLogo}
            alt={companyName}
            className="h-8 w-auto max-w-[150px] object-contain opacity-90 shrink-0" />

          <h1 className="text-2xl font-bold text-gray-900 mb-4">ברוכים הבאים ל{companyName}</h1>
          <p className="text-gray-600 mb-6">מערכת ניהול אירועים מתקדמת</p>
          {children}
        </div>
      </div>);

  }

  const currentNavItems = user.user_type === 'admin' 
    ? getAdminNavItems(user.email) 
    : (navigationItems[user.user_type] || navigationItems.client);


  return (
    <>
    {/* הזרקת CSS לתיקון גלובלי במובייל - פתרון חכם לכפתורים חורגים */}
    <style>{`
      /* Sonner toast RTL fixes and swipe */
      [data-sonner-toast] {
        direction: rtl !important;
        text-align: right !important;
      }
      [data-sonner-toast] [data-close-button] {
        left: 0 !important;
        right: auto !important;
      }

      @media (max-width: 640px) {
        /* 1. כיווץ כפתורים: רק כאלו שיש בתוכם אייקון (svg) */
        main button.inline-flex.items-center:has(svg),
        header button.inline-flex.items-center:has(svg) {
          font-size: 0 !important; /* מעלים טקסט */
          padding: 8px !important;
          min-width: 38px !important;
          height: 38px !important;
          justify-content: center !important;
        }

        /* 2. כפתורים ללא אייקון: נשארים עם טקסט, רק מצטמצמים מעט כדי לחסוך מקום */
        main button.inline-flex.items-center:not(:has(svg)) {
          font-size: 13px !important;
          padding: 4px 10px !important;
          width: auto !important;
        }
        
        /* 3. הבטחה שהאייקון נשאר גלוי ובמרכז הכפתור */
        main button svg, header button svg {
          margin: 0 !important;
          width: 18px !important;
          height: 18px !important;
          display: block !important;
        }

        /* 4. טיפול במיכלים: כפתורים ירדו שורה (Wrap) במקום לדחוף את המסך */
        .flex.gap-2, .flex.gap-3, .flex.space-x-2 {
          flex-wrap: wrap !important;
          justify-content: flex-end !important;
          gap: 6px !important;
        }

        /* 5. נעילת רוחב מסך למניעת הזחה שמאלה */
        html, body {
          max-width: 100vw !important;
          overflow-x: hidden !important;
          position: relative;
        }
      }
    `}</style>

    <div dir="rtl" className="min-h-screen w-full flex overflow-x-hidden relative" style={{
        backgroundImage: `url('${backgroundUrl}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed"
      }}>
      <div className="min-h-screen bg-black/20 backdrop-blur-sm flex-1 flex">
        {/* Sidebar */}
        <div className={`fixed inset-y-0 right-0 z-50 w-72 bg-white/95 backdrop-blur-sm shadow-2xl transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'} lg:relative lg:inset-y-auto lg:w-72 lg:flex-shrink-0 ${

          sidebarOpen ? 'lg:translate-x-0' : 'lg:translate-x-full lg:!w-0 lg:overflow-hidden'} ${
          !sidebarOpen && 'invisible lg:visible'}`}>
            
          <div className="flex items-center justify-between p-6 border-b lg:justify-center relative">
            <div className="flex items-center space-x-3 space-x-reverse">
              <img
                  src={companyLogo}
                  alt={companyName}
                  className="h-10 lg:h-12 w-auto" />

            </div>
            <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden">

              <X className="h-6 w-6" />
            </Button>
          </div>

          <div className="flex flex-col flex-1 overflow-y-auto">
            <nav className="flex-1 px-6 py-4 space-y-2">
              {currentNavItems.map((item) =>
                <Link
                  key={item.title}
                  to={item.url}
                  className={`flex items-center px-4 py-3 rounded-xl transition-all duration-200 text-sm lg:text-base ${
                  location.pathname.startsWith(item.url.split('?')[0]) ?
                  'bg-gradient-to-r from-red-800 to-red-700 text-white shadow-lg' :
                  'text-gray-700 hover:bg-red-50'}`
                  }
                  onClick={() => setSidebarOpen(false)}>

                  <item.icon className="h-4 w-4 lg:h-5 lg:w-5 ml-2 lg:ml-3" />
                  <span className="font-medium">{item.title}</span>
                </Link>
                )}
            </nav>

            <div className="p-6 border-t mt-auto">
              <div className="flex items-center space-x-3 space-x-reverse mb-4">
                <Avatar className="h-10 w-10 lg:h-12 lg:w-12">
                  <AvatarImage src="" />
                  <AvatarFallback className="bg-red-800 text-white text-sm lg:text-base">
                    {user.full_name?.charAt(0) || 'מ'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm lg:text-base truncate">{user.full_name}</p>
                  <p className="text-xs lg:text-sm text-gray-500 truncate">{user.email}</p>
                </div>
              </div>
              {/* <Button
                                      variant="outline"
                                      className="w-full justify-start text-sm lg:text-base border-red-200 text-red-800 hover:bg-red-50 mb-2"
                                      onClick={() => setShowCalendarConnect(true)}
                                    >
                                      <Calendar className="h-4 w-4 ml-2" />
                                      חיבור יומן Google
                                    </Button> */}
                <Link
                  to={createPageUrl("MyNotificationSettings")}
                  className="flex items-center w-full justify-start text-sm lg:text-base border border-red-200 text-red-800 hover:bg-red-50 rounded-md px-4 py-2 mb-2"
                  onClick={() => setSidebarOpen(false)}>
                  <Bell className="h-4 w-4 ml-2" />
                  הגדרות התראות
                </Link>
                <Button
                  variant="outline"
                  className="w-full justify-start text-sm lg:text-base border-red-200 text-red-800 hover:bg-red-50"
                  onClick={handleLogout}>

                  <LogOut className="h-4 w-4 ml-2" />
                  יציאה
                </Button>
              </div>
            </div>
          </div>

        {sidebarOpen &&
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)} />

          }

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="flex items-center justify-between p-2 sm:p-4 border-b border-white/20 gap-1">
          {/* כפתור תפריט - צד ימין ב-RTL */}
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ 
              width: '44px', 
              height: '44px', 
              minWidth: '44px', 
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0
            }}
            className="rounded-lg text-white hover:bg-white/20 active:bg-white/30 transition-colors shrink-0"
            aria-label="פתח תפריט"
          >
            <Menu className="h-6 w-6 pointer-events-none" />
          </button>

          {/* מיכל לוגו מרכזי - ממורכז בין הכפתור לדיב הריק */}
          <div className="flex-1 flex justify-center items-center overflow-hidden px-1">
            <img
              src={companyLogo}
              alt={companyName}
              className="h-9 w-auto object-contain opacity-90 shrink-0"
            />
            <span className="text-white font-medium text-sm hidden sm:block mr-3 truncate">
              {companyName}
            </span>
          </div>

          {/* פעמון התראות */}
          <NotificationBell user={user} />

          {/* כפתור חזרה אחורה - מופיע רק אם אנחנו לא בדף הראשי/דשבורד */}
          {location.pathname !== "/" && !location.pathname.endsWith("Dashboard") ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                navigate(-1);
              }}
              style={{ 
                width: '44px', 
                height: '44px', 
                minWidth: '44px', 
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0
              }}
              className="rounded-lg text-white hover:bg-white/20 active:bg-white/30 transition-colors shrink-0"
              aria-label="חזור למסך הקודם"
            >
              <ArrowRight className="h-6 w-6 pointer-events-none" />
            </button>
          ) : (
            /* אלמנט ריק לאיזון המרכוז כשאנחנו בדשבורד */
            <div style={{ width: '44px' }} className="shrink-0"></div>
          )}
        </header>

          <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 w-full max-w-[100vw] relative">
            <div className="p-4 sm:p-6 lg:p-8 w-full max-w-full box-border overflow-x-hidden">
              {children}
            </div>
            <footer className="text-center text-xs text-gray-400 py-3 border-t border-white/10">
              © {new Date().getFullYear()} Developed by Natan Bakshi
            </footer>
          </main>
        </div>
      </div>
      
      {user &&
                <>
                  <TermsPopup user={user} />
                  <PushNotificationManager />
                  <OneSignalInitializer user={user} />
                  <PushNotificationPrompt user={user} />
          {/* {showCalendarConnect && (
              <GoogleCalendarConnect 
                user={user} 
                onClose={() => setShowCalendarConnect(false)} 
              />
             )} */}
        </>
        }
      <SonnerToaster 
        position="top-center" 
        dir="rtl" 
        closeButton 
        richColors 
        duration={4000}
        expand={true}
        visibleToasts={3}
        toastOptions={{
          style: { direction: 'rtl', textAlign: 'right' },
          className: 'sonner-toast-rtl'
        }}
      />

      {/* OneSignal Firebase Proxy Bridge */}
      <iframe 
        id="onesignal-subscribe-frame"
        src="https://pulse-notifications-6886e.web.app/subscribe.html"
        style={{ display: 'none' }}
        title="OneSignal Bridge"
      />
      </div>
      </>);

}