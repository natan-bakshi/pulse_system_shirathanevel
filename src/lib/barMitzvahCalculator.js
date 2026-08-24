import { HDate, HebrewCalendar, ParshaEvent } from '@hebcal/core';

const HEBREW_MONTHS = {
  1: 'ניסן', 2: 'אייר', 3: 'סיוון', 4: 'תמוז', 5: 'אב', 6: 'אלול',
  7: 'תשרי', 8: 'חשוון', 9: 'כסלו', 10: 'טבת', 11: 'שבט', 12: 'אדר', 13: 'אדר ב׳',
};

const toHebrewNumeral = (number) => {
  const specialNumbers = { 15: 'טו', 16: 'טז' };
  const letters = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
  let remaining = specialNumbers[number] ? 0 : number;
  let output = specialNumbers[number] || '';

  letters.forEach(([value, letter]) => {
    while (remaining >= value) {
      output += letter;
      remaining -= value;
    }
  });

  return output.length === 1 ? `${output}׳` : `${output.slice(0, -1)}״${output.slice(-1)}`;
};

const formatHebrewDate = (date) => {
  const month = date.getMonth() === 12 && HDate.isLeapYear(date.getFullYear()) ? 'אדר א׳' : HEBREW_MONTHS[date.getMonth()];
  const year = `ה${toHebrewNumeral(date.getFullYear() % 1000)}`;
  return `${toHebrewNumeral(date.getDate())} ${month} ${year}`;
};

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

const removeParashaPrefix = (name) => name
  .replace(/^פרשת\s+/, '')
  .replace(/^פ[\u0591-\u05C7]*ר[\u0591-\u05C7]*ש[\u0591-\u05C7]*ת\s+/, '');

const findWeeklyParasha = (targetDate, isIsrael = true) => {
  const saturday = new HDate(targetDate.greg());
  const daysToSaturday = (6 - saturday.greg().getDay() + 7) % 7;
  const weeklyDate = daysToSaturday ? saturday.next().add(daysToSaturday - 1) : saturday;
  const sedra = HebrewCalendar.getSedra(weeklyDate.getFullYear(), isIsrael).lookup(weeklyDate);
  return sedra.chag ? 'אין פרשה בשבת זו' : removeParashaPrefix(new ParshaEvent(sedra).render('he'));
};

export const calculateBarMitzvah = (birthDateValue, isAfterSunset, type = 'bar', isIsrael = true) => {
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
    parashatHashavua: findWeeklyParasha(mitzvahDate, isIsrael),
  };
};

export const getSaturdayParasha = (date) => {
  if (date.getDay() !== 6) return null;
  const hebrewDate = new HDate(date);
  const sedra = HebrewCalendar.getSedra(hebrewDate.getFullYear(), true).lookup(hebrewDate);
  return sedra.chag ? null : removeParashaPrefix(new ParshaEvent(sedra).render('he'));
};