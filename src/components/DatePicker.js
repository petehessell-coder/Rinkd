import React from 'react';
import ReactDatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const inputStyle = {
  width: '100%',
  background: '#07111F',
  border: '0.5px solid rgba(46,91,140,0.5)',
  borderRadius: 8,
  padding: '10px 12px',
  color: '#F4F7FA',
  fontFamily: 'Barlow, sans-serif',
  fontSize: 14,
  outline: 'none',
};

// Parse a YYYY-MM-DD string as LOCAL midnight, not UTC midnight.
// `new Date("2026-06-13")` is interpreted by JS as UTC, so in any
// timezone west of UTC it renders as the previous day at evening — Pete
// caught this when picking a tournament start date in Eastern Time
// returned a date one day earlier. Falls back to the default Date
// constructor for ISO strings that include a time component.
function parseLocalDate(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return new Date(value);
}

export default function DatePicker({ value, onChange, placeholder }) {
  const selected = parseLocalDate(value);
  return (
    <ReactDatePicker
      selected={selected}
      onChange={date => {
        if (!date) { onChange(''); return; }
        const y = date.getFullYear();
        const m = String(date.getMonth()+1).padStart(2,'0');
        const d = String(date.getDate()).padStart(2,'0');
        onChange(`${y}-${m}-${d}`);
      }}
      placeholderText={placeholder || 'Select date'}
      dateFormat="MMM d, yyyy"
      customInput={<input style={inputStyle} />}
      calendarClassName="rinkd-cal"
      showMonthDropdown
      showYearDropdown
      dropdownMode="select"
    />
  );
}
