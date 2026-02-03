// Notification Helper Functions
// This file contains shared utilities for the notification system

/**
 * Replaces placeholders in a template string with actual values
 * @param {string} template - Template with {{variable}} placeholders
 * @param {object} data - Object containing values to replace
 * @returns {string} - Template with replaced values
 */
export function replacePlaceholders(template, data) {
    if (!template) return '';
    
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const value = data[key];
        if (value !== undefined && value !== null) {
            return String(value);
        }
        return match; // Keep original if no value found
    });
}

/**
 * Checks if current time is within quiet hours for a user
 * @param {number} quietStart - Hour when quiet time starts (0-23)
 * @param {number} quietEnd - Hour when quiet time ends (0-23)
 * @param {string} timezone - User's timezone (default: Asia/Jerusalem)
 * @returns {boolean} - True if currently in quiet hours
 */
export function isInQuietHours(quietStart, quietEnd, timezone = 'Asia/Jerusalem') {
    if (quietStart === undefined || quietEnd === undefined || quietStart === null || quietEnd === null) {
        return false;
    }
    
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone
    });
    const currentHour = parseInt(formatter.format(now), 10);
    
    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (quietStart > quietEnd) {
        return currentHour >= quietStart || currentHour < quietEnd;
    }
    
    // Handle same-day quiet hours (e.g., 14:00 to 16:00)
    return currentHour >= quietStart && currentHour < quietEnd;
}

/**
 * Calculates when quiet hours end for scheduling delayed push
 * @param {number} quietEnd - Hour when quiet time ends (0-23)
 * @param {string} timezone - User's timezone (default: Asia/Jerusalem)
 * @returns {Date} - Date object for when quiet hours end
 */
export function getQuietHoursEndTime(quietEnd, timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone
    });
    const currentHour = parseInt(formatter.format(now), 10);
    
    // Create a date for today at quietEnd hour
    const endTime = new Date(now);
    endTime.setHours(quietEnd, 0, 0, 0);
    
    // If we're past quiet end today, schedule for tomorrow
    if (currentHour >= quietEnd) {
        endTime.setDate(endTime.getDate() + 1);
    }
    
    return endTime;
}

/**
 * Checks if user has enabled notifications for a specific template type
 * @param {object} preferences - User's notification_preferences object
 * @param {string} templateType - The notification template type
 * @returns {boolean} - True if notifications are enabled
 */
export function isNotificationEnabled(preferences, templateType) {
    if (!preferences) return true; // Default to enabled if no preferences set
    
    const pref = preferences[templateType];
    if (pref === undefined) return true; // Default to enabled if not specifically set
    
    // Handle both old format {enabled: true} and simple boolean
    if (typeof pref === 'object') {
        return pref.enabled !== false;
    }
    
    return pref !== false;
}

/**
 * Builds a deep link URL from template parameters
 * @param {string} basePage - Base page name
 * @param {string} paramsMapJson - JSON string of parameter mapping
 * @param {object} data - Data object for placeholder replacement
 * @returns {string} - Complete URL path
 */
export function buildDeepLink(basePage, paramsMapJson, data) {
    if (!basePage) return '/';
    
    let url = `/${basePage}`;
    
    if (paramsMapJson) {
        try {
            const paramsMap = JSON.parse(paramsMapJson);
            const params = new URLSearchParams();
            
            for (const [key, valueTemplate] of Object.entries(paramsMap)) {
                const value = replacePlaceholders(valueTemplate, data);
                if (value && !value.includes('{{')) {
                    params.append(key, value);
                }
            }
            
            const paramString = params.toString();
            if (paramString) {
                url += `?${paramString}`;
            }
        } catch (e) {
            console.warn('Failed to parse deep_link_params_map:', e);
        }
    }
    
    return url;
}

/**
 * Formats a date for display in Hebrew
 * @param {string|Date} date - Date to format
 * @returns {string} - Formatted date string
 */
export function formatDateHebrew(date) {
    if (!date) return '';
    
    const d = new Date(date);
    return d.toLocaleDateString('he-IL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Calculates days between two dates
 * @param {string|Date} date1 - First date
 * @param {string|Date} date2 - Second date (default: now)
 * @returns {number} - Number of days between dates
 */
export function daysBetween(date1, date2 = new Date()) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2 - d1);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}