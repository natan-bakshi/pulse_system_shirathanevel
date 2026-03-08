import React, { useState, useEffect, useCallback } from "react";
import Joyride, { STATUS, ACTIONS, EVENTS } from "react-joyride";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";

const CURRENT_TOUR_VERSION = "v1.0";

// Custom tooltip component for RTL support
function TourTooltip({ continuous, index, step, backProps, closeProps, primaryProps, skipProps, tooltipProps, size }) {
  return (
    <div {...tooltipProps} dir="rtl" className="bg-white rounded-xl shadow-2xl border border-gray-200 max-w-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-800 to-red-700 px-5 py-3">
        <div className="flex items-center justify-between">
          {step.title && (
            <h3 className="text-white font-bold text-base">{step.title}</h3>
          )}
          <span className="text-white/70 text-xs">{index + 1} / {size}</span>
        </div>
      </div>
      
      {/* Body */}
      <div className="px-5 py-4">
        <p className="text-gray-700 text-sm leading-relaxed">{step.content}</p>
      </div>
      
      {/* Footer */}
      <div className="px-5 py-3 bg-gray-50 border-t flex items-center justify-between gap-2">
        <button
          {...skipProps}
          className="text-gray-400 text-xs hover:text-gray-600 transition-colors"
        >
          דלג על הסיור
        </button>
        <div className="flex gap-2">
          {index > 0 && (
            <button
              {...backProps}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
            >
              הקודם
            </button>
          )}
          <button
            {...primaryProps}
            className="px-4 py-1.5 text-sm bg-red-800 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
          >
            {continuous ? (index === size - 1 ? "סיים" : "הבא") : "סגור"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UserOnboardingTour({ user }) {
  const [run, setRun] = useState(false);
  const [steps, setSteps] = useState([]);
  const [tourChecked, setTourChecked] = useState(false);

  // Fetch tour steps from DB
  const { data: tourSteps = [] } = useQuery({
    queryKey: ['tourSteps', user?.user_type],
    queryFn: () => base44.entities.TourStep.filter({
      user_type: user?.user_type || 'client',
      tour_version: CURRENT_TOUR_VERSION,
      is_active: true
    }),
    enabled: !!user?.user_type,
    staleTime: 30 * 60 * 1000,
    cacheTime: 60 * 60 * 1000
  });

  // Listen for manual tour trigger from UserSettings
  useEffect(() => {
    const handler = () => {
      if (tourSteps.length > 0) {
        // Open sidebar so nav items are visible for tour
        window.dispatchEvent(new Event('pulse_open_sidebar'));
        const sorted = [...tourSteps].sort((a, b) => a.step_order - b.step_order);
        const joySteps = sorted.map(s => ({
          target: s.target_selector,
          title: s.title || '',
          content: s.content,
          placement: s.placement || 'auto',
          disableBeacon: true,
          spotlightClicks: true
        }));
        setSteps(joySteps);
        setTimeout(() => setRun(true), 500);
      }
    };
    window.addEventListener('pulse_start_tour', handler);
    return () => window.removeEventListener('pulse_start_tour', handler);
  }, [tourSteps]);

  // Check if tour should run automatically
  useEffect(() => {
    if (!user || tourChecked || tourSteps.length === 0) return;

    const userVersion = user.tour_version || '';
    const completed = user.tour_completed || false;
    const skipped = user.tour_skipped || false;

    // Show tour if version mismatch or never completed/skipped
    if (userVersion !== CURRENT_TOUR_VERSION || (!completed && !skipped)) {
      // Open sidebar and delay to let the page render and elements appear
      window.dispatchEvent(new Event('pulse_open_sidebar'));
      const timer = setTimeout(() => {
        const sorted = [...tourSteps].sort((a, b) => a.step_order - b.step_order);
        const joySteps = sorted.map(s => ({
          target: s.target_selector,
          title: s.title || '',
          content: s.content,
          placement: s.placement || 'auto',
          disableBeacon: true,
          spotlightClicks: true
        }));
        setSteps(joySteps);
        setRun(true);
      }, 1500);
      
      setTourChecked(true);
      return () => clearTimeout(timer);
    }
    
    setTourChecked(true);
  }, [user, tourSteps, tourChecked]);

  const handleJoyrideCallback = useCallback(async (data) => {
    const { status, action } = data;
    const finishedStatuses = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      setRun(false);
      
      const isSkipped = status === STATUS.SKIPPED;
      
      try {
        await base44.auth.updateMe({
          tour_version: CURRENT_TOUR_VERSION,
          tour_completed: !isSkipped,
          tour_skipped: isSkipped
        });
      } catch (error) {
        console.warn("Failed to update tour status:", error);
      }
    }
  }, []);

  if (!user || steps.length === 0) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      showSkipButton
      showProgress={false}
      scrollToFirstStep
      scrollOffset={100}
      disableOverlayClose={false}
      disableCloseOnEsc={false}
      spotlightPadding={8}
      callback={handleJoyrideCallback}
      tooltipComponent={TourTooltip}
      locale={{
        back: 'הקודם',
        close: 'סגור',
        last: 'סיים',
        next: 'הבא',
        skip: 'דלג'
      }}
      styles={{
        options: {
          zIndex: 10000,
          arrowColor: '#fff',
          overlayColor: 'rgba(0, 0, 0, 0.5)'
        },
        spotlight: {
          borderRadius: 12
        }
      }}
      floaterProps={{
        disableAnimation: false
      }}
    />
  );
}

export { CURRENT_TOUR_VERSION };