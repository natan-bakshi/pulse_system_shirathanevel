import { HDate, HebrewCalendar, ParshaEvent } from '@hebcal/core';

const formatHebrewDate = (date) => date.render('he');

const resolveTargetMonth = (birthDate, targetYear) => {
  const month = birthDate.getMonth();
  if (month === 13 && !HDate.isLeapYear(targetYear)) return 12;
  if (month === 12 && !HDate.isLeapYear(targetYear)) return 12;
  if (month === 12 && HDate.isLeapYear(targetYear) && !HDate.isLeapYear(birthDate.getFullYear())) return 13;
  return month;
};

const findBarMitzvahDate = (birthDate, age) => {
  const targetYear = birthDate.getFullYear() + age;
  const targetMonth = resolveTargetMonth(birthDate, targetYear);
  const requestedDay = birthDate.getDate();
  const candidate = new HDate(requestedDay, targetMonth, targetYear);

  return candidate.getMonth() === targetMonth ? candidate : new HDate(1, targetMonth + 1, targetYear);
};

const findWeeklyParasha = (targetDate) => {
  const saturday = new HDate(targetDate.greg());
  const daysToSaturday = (6 - saturday.greg().getDay() + 7) % 7;
  const weeklyDate = daysToSaturday ? saturday.next().add(daysToSaturday - 1) : saturday;
  const sedra = HebrewCalendar.getSedra(weeklyDate.getFullYear(), true).lookup(weeklyDate);
  return sedra.chag ? 'אין פרשה בשבת זו' : new ParshaEvent(sedra).render('he');
};

export const calculateBarMitzvah = (birthDateValue, isAfterSunset, type = 'bar') => {
  if (!birthDateValue) throw new Error('יש לבחור תאריך לידה');

  const gregorianBirthDate = new Date(`${birthDateValue}T12:00:00`);
  if (Number.isNaN(gregorianBirthDate.getTime())) throw new Error('תאריך הלידה אינו תקין');

  let birthHebrewDate = new HDate(gregorianBirthDate);
  if (isAfterSunset) birthHebrewDate = birthHebrewDate.next();

  const mitzvahDate = findBarMitzvahDate(birthHebrewDate, type === 'bat' ? 12 : 13);
  const mitzvahGregorianDate = mitzvahDate.greg();

  return {
    birthHebrewDate: formatHebrewDate(birthHebrewDate),
    barMitzvahHebrewDate: formatHebrewDate(mitzvahDate),
    barMitzvahGregorianDate: mitzvahGregorianDate,
    parashatHashavua: findWeeklyParasha(mitzvahDate),
  };
};

export const getSaturdayParasha = (date) => {
  if (date.getDay() !== 6) return null;
  const hebrewDate = new HDate(date);
  const sedra = HebrewCalendar.getSedra(hebrewDate.getFullYear(), true).lookup(hebrewDate);
  return sedra.chag ? null : new ParshaEvent(sedra).render('he');
};