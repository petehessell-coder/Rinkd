import React from 'react';
import ReactDatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { C } from '../lib/tokens';

const inputStyle = {
  width: '100%',
  background: C.dark,
  border: '0.5px solid rgba(46,91,140,0.5)',
  borderRadius: 8,
  padding: '10px 12px',
  color: C.ice,
  fontFamily: 'Barlow, sans-serif',
  fontSize: 14,
  outline: 'none',
};

export default function DateTimePicker({ value, onChange, placeholder }) {
  const selected = value ? new Date(value) : null;
  return (
    <ReactDatePicker
      selected={selected}
      onChange={date => onChange(date ? date.toISOString() : '')}
      placeholderText={placeholder || 'Select date & time'}
      dateFormat="MMM d, yyyy h:mm aa"
      showTimeSelect
      timeIntervals={15}
      timeCaption="Time"
      customInput={<input style={inputStyle} />}
      calendarClassName="rinkd-cal"
      showMonthDropdown
      showYearDropdown
      dropdownMode="select"
    />
  );
}
