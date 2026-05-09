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

export default function DatePicker({ value, onChange, placeholder }) {
  const selected = value ? new Date(value) : null;
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
