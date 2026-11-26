import { evaluateFormula, getOptionBadgeStyle, emitCellFocus, emitCellBlur, emitLiveTyping, type Entry, type Column, type CellLockInfo } from '../../lib/api';
import toast from 'react-hot-toast';
import { ImageCompressionModule } from '../../lib/imageCompressionModule';
import { formatCurrency } from '../../lib/formatters';
import { Calendar, ChevronDown, Image as ImageIcon, Mail, Phone, Globe, ListOrdered, IndianRupee, Maximize2, Bell, PenTool, Eye, EyeOff } from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNotifications } from '../../lib/NotificationContext';

// ── Highlight matching text ──
const HighlightedText = React.memo(function HighlightedText({ text, searchTerm }: { text: string; searchTerm?: string }) {
  if (!searchTerm || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const sLower = searchTerm.toLowerCase();
  const idx = lower.indexOf(sLower);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + searchTerm.length)}</mark>
      {text.slice(idx + searchTerm.length)}
    </>
  );
});

export function OptionBadge({ col, value, searchTerm }: { col: Column | any; value: string; searchTerm?: string }) {
  const style = getOptionBadgeStyle(col, value);
  return (
    <span 
      className="option-badge-pill" 
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 700,
        border: '1px solid',
        lineHeight: '1.3',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        ...style
      }}
    >
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: style.color, flexShrink: 0 }} />
      <HighlightedText text={value} searchTerm={searchTerm} />
    </span>
  );
}



// Isolated memo component so formula evaluation only runs when its inputs change
const FormulaCell = React.memo(({ idx, col, entry, registerColumns, onKeyDown }: {
  idx: number; col: Column; entry: Entry; registerColumns: Column[]; onKeyDown?: (e: React.KeyboardEvent) => void;
}) => {
  const result = evaluateFormula(col.formula || '', entry, registerColumns);
  return (
    <div
      data-cell={`cell-${idx}-${col.id}`}
      tabIndex={0}
      className="cell-formula"
      onKeyDown={onKeyDown}
    >
      {result || '–'}
    </div>
  );
});

interface SpreadsheetTextInputProps {
  idx: number;
  col: Column;
  entry: Entry;
  visibleColumns: Column[];
  colIdx: number;
  totalRows: number;
  handleCellChange: (entryId: number, columnId: string, value: string) => void | boolean;
  type?: string;
  placeholder?: string;
  searchTerm?: string;
  readOnly?: boolean;
  suggestions?: string[];
  scrollToColumn?: (colIdx: number) => void;
  registerId?: number | string;
  currentUserName?: string;
  currentUserId?: string | number;
  cellLock?: CellLockInfo | null;
}

const SplitTextInput = React.memo(({ idx, col, entry, visibleColumns, colIdx, totalRows, handleCellChange, type = 'text', placeholder, readOnly, scrollToColumn }: SpreadsheetTextInputProps) => {
  const initialValue = entry.cells?.[col.id.toString()] || '';
  const [leftVal, rightVal] = typeof initialValue === 'string' && initialValue.includes(' ||| ') ? initialValue.split(' ||| ') : ['', ''];
  const [leftState, setLeftState] = useState(leftVal || '');
  const [rightState, setRightState] = useState(rightVal || '');
  const [isEditingLeft, setIsEditingLeft] = useState(false);
  const [isEditingRight, setIsEditingRight] = useState(false);
  const leftStateRef = useRef(leftState);
  const rightStateRef = useRef(rightState);
  const isEditingLeftRef = useRef(false);
  const isEditingRightRef = useRef(false);

  const latestSplitRef = useRef({ initialValue, entryId: entry.id, colId: col.id.toString(), handleCellChange, readOnly });
  latestSplitRef.current = { initialValue, entryId: entry.id, colId: col.id.toString(), handleCellChange, readOnly };

  useEffect(() => { leftStateRef.current = leftState; }, [leftState]);
  useEffect(() => { rightStateRef.current = rightState; }, [rightState]);
  useEffect(() => { isEditingLeftRef.current = isEditingLeft; }, [isEditingLeft]);
  useEffect(() => { isEditingRightRef.current = isEditingRight; }, [isEditingRight]);

  useEffect(() => {
    return () => {
      if (!latestSplitRef.current.readOnly && (isEditingLeftRef.current || isEditingRightRef.current)) {
        const finalVal = leftStateRef.current + ' ||| ' + rightStateRef.current;
        if (finalVal !== latestSplitRef.current.initialValue) {
          latestSplitRef.current.handleCellChange(latestSplitRef.current.entryId, latestSplitRef.current.colId, finalVal);
        }
      }
    };
  }, [entry.id, col.id]);

  useEffect(() => {
    const [l, r] = typeof initialValue === 'string' && initialValue.includes(' ||| ') ? initialValue.split(' ||| ') : ['', ''];
    if (!isEditingLeft) {
      setLeftState(l || '');
      leftStateRef.current = l || '';
    }
    if (!isEditingRight) {
      setRightState(r || '');
      rightStateRef.current = r || '';
    }
  }, [initialValue, isEditingLeft, isEditingRight]);

  const saveSplitVal = useCallback((left: string, right: string) => {
    const finalVal = left + ' ||| ' + right;
    if (finalVal !== initialValue) {
      handleCellChange(entry.id, col.id.toString(), finalVal);
    }
  }, [initialValue, entry.id, col.id, handleCellChange]);

  const handleLeftBlur = () => {
    setTimeout(() => {
      const wasEditing = isEditingLeftRef.current;
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      if (!readOnly && wasEditing) {
        saveSplitVal(leftStateRef.current, rightStateRef.current);
      }
    }, 150);
  };

  const handleRightBlur = () => {
    setTimeout(() => {
      const wasEditing = isEditingRightRef.current;
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      if (!readOnly && wasEditing) {
        saveSplitVal(leftStateRef.current, rightStateRef.current);
      }
    }, 150);
  };

  const navigateVertical = (direction: 'up' | 'down', isRight: boolean) => {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx >= 0 && targetIdx < totalRows) {
      setTimeout(() => {
        const suffix = isRight ? '-right' : '';
        const el = document.getElementById(`cell-${targetIdx}-${col.id}${suffix}`);
        if (el) {
          el.focus();
        } else if (isRight) {
          const fallback = document.getElementById(`cell-${targetIdx}-${col.id}`);
          if (fallback) fallback.focus();
        }
      }, 50);
    }
  };

  const navigateHorizontal = (direction: 'left' | 'right', isRight: boolean) => {
    if (direction === 'left') {
      if (isRight) {
        const el = document.getElementById(`cell-${idx}-${col.id}`);
        if (el) el.focus();
      } else {
        const prevCol = visibleColumns[colIdx - 1];
        if (prevCol) {
          setTimeout(() => {
            const el = document.getElementById(`cell-${idx}-${prevCol.id}-right`) || document.getElementById(`cell-${idx}-${prevCol.id}`);
            if (el) el.focus();
          }, 50);
        }
      }
    } else {
      if (!isRight) {
        const el = document.getElementById(`cell-${idx}-${col.id}-right`);
        if (el) el.focus();
      } else {
        const nextCol = visibleColumns[colIdx + 1];
        if (nextCol) {
          setTimeout(() => {
            const el = document.getElementById(`cell-${idx}-${nextCol.id}`);
            if (el) el.focus();
          }, 50);
        }
      }
    }
  };

  const handleLeftKeyDown = (e: React.KeyboardEvent<any>) => {
    if (e.key === 'Escape') {
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      setLeftState(leftVal || '');
      leftStateRef.current = leftVal || '';
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
      return;
    }
    if (!isEditingLeft && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      if (!readOnly && leftStateRef.current !== '') {
        setLeftState('');
        leftStateRef.current = '';
        saveSplitVal('', rightStateRef.current);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateVertical('up', false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateVertical('down', false);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateHorizontal('left', false);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateHorizontal('right', false);
    } else if (!isEditingLeft && !readOnly && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      isEditingLeftRef.current = true;
      setIsEditingLeft(true);
      setLeftState(e.key);
      leftStateRef.current = e.key;
      e.preventDefault();
      return;
    }
  };

  const handleRightKeyDown = (e: React.KeyboardEvent<any>) => {
    if (e.key === 'Escape') {
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      setRightState(rightVal || '');
      rightStateRef.current = rightVal || '';
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
      return;
    }
    if (!isEditingRight && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      if (!readOnly && rightStateRef.current !== '') {
        setRightState('');
        rightStateRef.current = '';
        saveSplitVal(leftStateRef.current, '');
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateVertical('up', true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateVertical('down', true);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateHorizontal('left', true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateHorizontal('right', true);
    } else if (!isEditingRight && !readOnly && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      isEditingRightRef.current = true;
      setIsEditingRight(true);
      setRightState(e.key);
      rightStateRef.current = e.key;
      e.preventDefault();
      return;
    }
  };

  const handleLeftInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
      setTimeout(() => {
        const el = document.getElementById(`cell-${idx}-${col.id}-right`);
        if (el) el.focus();
      }, 50);
    } else if (e.key === 'Escape') {
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      setLeftState(leftVal || '');
      leftStateRef.current = leftVal || '';
    }
  };

  const handleRightInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
      const nextCol = visibleColumns[colIdx + 1];
      if (nextCol) {
        setTimeout(() => {
          const el = document.getElementById(`cell-${idx}-${nextCol.id}`);
          if (el) el.focus();
        }, 50);
      }
    } else if (e.key === 'Escape') {
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      setRightState(rightVal || '');
      rightStateRef.current = rightVal || '';
    }
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center' }}>
      <div style={{ width: '50%', height: '100%', borderRight: '1px solid var(--border-v)', display: 'flex', alignItems: 'center' }}>
        {isEditingLeft && !readOnly ? (
          <input
            id={`cell-${idx}-${col.id}`}
            className={`cell-input ${readOnly ? 'cell-readonly' : ''}`}
            value={leftState}
            onChange={(e) => setLeftState(e.target.value)}
            onBlur={handleLeftBlur}
            onKeyDown={handleLeftInputKeyDown}
            type={type}
            placeholder={placeholder}
            autoComplete="off"
            readOnly={readOnly}
            autoFocus
            style={{
              width: '100%',
              height: '100%',
              boxSizing: 'border-box',
              border: 'none',
              outline: 'none',
              padding: '0 8px',
              background: 'transparent',
              color: 'inherit',
            }}
          />
        ) : (
          <div
            id={`cell-${idx}-${col.id}`}
            data-cell={`cell-${idx}-${col.id}`}
            className={`cell-input cell-display-mode ${readOnly ? 'cell-readonly' : ''}`}
            tabIndex={readOnly ? -1 : 0}
            onBlur={handleLeftBlur}
            onKeyDown={handleLeftKeyDown}
            onDoubleClick={() => !readOnly && setIsEditingLeft(true)}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              cursor: readOnly ? 'default' : 'cell',
              userSelect: 'none',
              outline: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {leftState || <span className="cell-placeholder" style={{ opacity: 0.4 }}>—</span>}
          </div>
        )}
      </div>

      <div style={{ width: '50%', height: '100%', display: 'flex', alignItems: 'center' }}>
        {isEditingRight && !readOnly ? (
          <input
            id={`cell-${idx}-${col.id}-right`}
            className={`cell-input ${readOnly ? 'cell-readonly' : ''}`}
            value={rightState}
            onChange={(e) => setRightState(e.target.value)}
            onBlur={handleRightBlur}
            onKeyDown={handleRightInputKeyDown}
            type={type}
            placeholder={placeholder}
            autoComplete="off"
            readOnly={readOnly}
            autoFocus
            style={{
              width: '100%',
              height: '100%',
              boxSizing: 'border-box',
              border: 'none',
              outline: 'none',
              padding: '0 8px',
              background: 'transparent',
              color: 'inherit',
            }}
          />
        ) : (
          <div
            id={`cell-${idx}-${col.id}-right`}
            data-cell={`cell-${idx}-${col.id}-right`}
            className={`cell-input cell-display-mode ${readOnly ? 'cell-readonly' : ''}`}
            tabIndex={readOnly ? -1 : 0}
            onBlur={handleRightBlur}
            onKeyDown={handleRightKeyDown}
            onDoubleClick={() => !readOnly && setIsEditingRight(true)}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              cursor: readOnly ? 'default' : 'cell',
              userSelect: 'none',
              outline: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {rightState || <span className="cell-placeholder" style={{ opacity: 0.4 }}>—</span>}
          </div>
        )}
      </div>
    </div>
  );
});

const SplitCurrencyCell = React.memo(({ idx, col, entry, colIdx, totalRows, visibleColumns, handleCellChange, readOnly, scrollToColumn }: SpreadsheetTextInputProps) => {
  const rawValue = entry.cells?.[col.id.toString()] || '';
  const [leftAmount, rightAmount] = typeof rawValue === 'string' && rawValue.includes(' ||| ') ? rawValue.split(' ||| ') : ['', ''];
  const [leftState, setLeftState] = useState(leftAmount || '');
  const [rightState, setRightState] = useState(rightAmount || '');
  const [isEditingLeft, setIsEditingLeft] = useState(false);
  const [isEditingRight, setIsEditingRight] = useState(false);
  const leftStateRef = useRef(leftState);
  const rightStateRef = useRef(rightState);
  const isEditingLeftRef = useRef(false);
  const isEditingRightRef = useRef(false);

  const latestSplitCurrRef = useRef({ rawValue, entryId: entry.id, colId: col.id.toString(), handleCellChange, readOnly });
  latestSplitCurrRef.current = { rawValue, entryId: entry.id, colId: col.id.toString(), handleCellChange, readOnly };

  useEffect(() => { leftStateRef.current = leftState; }, [leftState]);
  useEffect(() => { rightStateRef.current = rightState; }, [rightState]);
  useEffect(() => { isEditingLeftRef.current = isEditingLeft; }, [isEditingLeft]);
  useEffect(() => { isEditingRightRef.current = isEditingRight; }, [isEditingRight]);

  useEffect(() => {
    return () => {
      if (!latestSplitCurrRef.current.readOnly && (isEditingLeftRef.current || isEditingRightRef.current)) {
        const finalVal = leftStateRef.current + ' ||| ' + rightStateRef.current;
        if (finalVal !== latestSplitCurrRef.current.rawValue) {
          latestSplitCurrRef.current.handleCellChange(latestSplitCurrRef.current.entryId, latestSplitCurrRef.current.colId, finalVal);
        }
      }
    };
  }, [entry.id, col.id]);

  useEffect(() => {
    const [l, r] = typeof rawValue === 'string' && rawValue.includes(' ||| ') ? rawValue.split(' ||| ') : ['', ''];
    if (!isEditingLeft) {
      setLeftState(l || '');
      leftStateRef.current = l || '';
    }
    if (!isEditingRight) {
      setRightState(r || '');
      rightStateRef.current = r || '';
    }
  }, [rawValue, isEditingLeft, isEditingRight]);

  const saveSplitVal = useCallback((left: string, right: string) => {
    const finalVal = left + ' ||| ' + right;
    if (finalVal !== rawValue) {
      handleCellChange(entry.id, col.id.toString(), finalVal);
    }
  }, [rawValue, entry.id, col.id, handleCellChange]);

  const handleLeftBlur = () => {
    setTimeout(() => {
      const wasEditing = isEditingLeftRef.current;
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      if (!readOnly && wasEditing) {
        saveSplitVal(leftStateRef.current, rightStateRef.current);
      }
    }, 150);
  };

  const handleRightBlur = () => {
    setTimeout(() => {
      const wasEditing = isEditingRightRef.current;
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      if (!readOnly && wasEditing) {
        saveSplitVal(leftStateRef.current, rightStateRef.current);
      }
    }, 150);
  };

  const navigateVertical = (direction: 'up' | 'down', isRight: boolean) => {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx >= 0 && targetIdx < totalRows) {
      setTimeout(() => {
        const suffix = isRight ? '-right' : '';
        const el = document.getElementById(`cell-${targetIdx}-${col.id}${suffix}`);
        if (el) {
          el.focus();
        } else if (isRight) {
          const fallback = document.getElementById(`cell-${targetIdx}-${col.id}`);
          if (fallback) fallback.focus();
        }
      }, 50);
    }
  };

  const navigateHorizontal = (direction: 'left' | 'right', isRight: boolean) => {
    if (direction === 'left') {
      if (isRight) {
        const el = document.getElementById(`cell-${idx}-${col.id}`);
        if (el) el.focus();
      } else {
        const prevCol = visibleColumns[colIdx - 1];
        if (prevCol) {
          setTimeout(() => {
            const el = document.getElementById(`cell-${idx}-${prevCol.id}-right`) || document.getElementById(`cell-${idx}-${prevCol.id}`);
            if (el) el.focus();
          }, 50);
        }
      }
    } else {
      if (!isRight) {
        const el = document.getElementById(`cell-${idx}-${col.id}-right`);
        if (el) el.focus();
      } else {
        const nextCol = visibleColumns[colIdx + 1];
        if (nextCol) {
          setTimeout(() => {
            const el = document.getElementById(`cell-${idx}-${nextCol.id}`);
            if (el) el.focus();
          }, 50);
        }
      }
    }
  };

  const handleLeftKeyDown = (e: React.KeyboardEvent<any>) => {
    if (e.key === 'Escape') {
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      setLeftState(leftAmount || '');
      leftStateRef.current = leftAmount || '';
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
      return;
    }
    if (!isEditingLeft && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      if (!readOnly && leftStateRef.current !== '') {
        setLeftState('');
        leftStateRef.current = '';
        saveSplitVal('', rightStateRef.current);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateVertical('up', false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateVertical('down', false);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateHorizontal('left', false);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateHorizontal('right', false);
    } else if (!isEditingLeft && !readOnly && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      isEditingLeftRef.current = true;
      setIsEditingLeft(true);
      setLeftState(e.key);
      leftStateRef.current = e.key;
      e.preventDefault();
      return;
    }
  };

  const handleRightKeyDown = (e: React.KeyboardEvent<any>) => {
    if (e.key === 'Escape') {
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      setRightState(rightAmount || '');
      rightStateRef.current = rightAmount || '';
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
      return;
    }
    if (!isEditingRight && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      if (!readOnly && rightStateRef.current !== '') {
        setRightState('');
        rightStateRef.current = '';
        saveSplitVal(leftStateRef.current, '');
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateVertical('up', true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateVertical('down', true);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateHorizontal('left', true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateHorizontal('right', true);
    } else if (!isEditingRight && !readOnly && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      isEditingRightRef.current = true;
      setIsEditingRight(true);
      setRightState(e.key);
      rightStateRef.current = e.key;
      e.preventDefault();
      return;
    }
  };

  const handleLeftInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
      setTimeout(() => {
        const el = document.getElementById(`cell-${idx}-${col.id}-right`);
        if (el) el.focus();
      }, 50);
    } else if (e.key === 'Escape') {
      isEditingLeftRef.current = false;
      setIsEditingLeft(false);
      setLeftState(leftAmount || '');
      leftStateRef.current = leftAmount || '';
    }
  };

  const handleRightInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      saveSplitVal(leftStateRef.current, rightStateRef.current);
      const nextCol = visibleColumns[colIdx + 1];
      if (nextCol) {
        setTimeout(() => {
          const el = document.getElementById(`cell-${idx}-${nextCol.id}`);
          if (el) el.focus();
        }, 50);
      }
    } else if (e.key === 'Escape') {
      isEditingRightRef.current = false;
      setIsEditingRight(false);
      setRightState(rightAmount || '');
      rightStateRef.current = rightAmount || '';
    }
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center' }}>
      <div style={{ width: '50%', height: '100%', borderRight: '1px solid var(--border-v)', display: 'flex', alignItems: 'center' }}>
        {isEditingLeft && !readOnly ? (
          <input
            id={`cell-${idx}-${col.id}`}
            className="cell-input currency-editing"
            value={leftState}
            onChange={(e) => setLeftState(e.target.value)}
            onBlur={handleLeftBlur}
            onKeyDown={handleLeftInputKeyDown}
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
            style={{
              width: '100%',
              height: '100%',
              boxSizing: 'border-box',
              border: 'none',
              outline: 'none',
              padding: '0 8px',
              background: 'transparent',
              color: 'inherit',
            }}
          />
        ) : (
          <div
            id={`cell-${idx}-${col.id}`}
            data-cell={`cell-${idx}-${col.id}`}
            className={`cell-currency ${readOnly ? 'cell-readonly' : ''}`}
            tabIndex={readOnly ? -1 : 0}
            onBlur={handleLeftBlur}
            onKeyDown={handleLeftKeyDown}
            onDoubleClick={() => !readOnly && setIsEditingLeft(true)}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              cursor: readOnly ? 'default' : 'cell',
              userSelect: 'none',
              outline: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {leftState ? formatCurrency(leftState) : <span className="cell-placeholder"><IndianRupee size={11} /> Amount</span>}
          </div>
        )}
      </div>

      <div style={{ width: '50%', height: '100%', display: 'flex', alignItems: 'center' }}>
        {isEditingRight && !readOnly ? (
          <input
            id={`cell-${idx}-${col.id}-right`}
            className="cell-input currency-editing"
            value={rightState}
            onChange={(e) => setRightState(e.target.value)}
            onBlur={handleRightBlur}
            onKeyDown={handleRightInputKeyDown}
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
            style={{
              width: '100%',
              height: '100%',
              boxSizing: 'border-box',
              border: 'none',
              outline: 'none',
              padding: '0 8px',
              background: 'transparent',
              color: 'inherit',
            }}
          />
        ) : (
          <div
            id={`cell-${idx}-${col.id}-right`}
            data-cell={`cell-${idx}-${col.id}-right`}
            className={`cell-currency ${readOnly ? 'cell-readonly' : ''}`}
            tabIndex={readOnly ? -1 : 0}
            onBlur={handleRightBlur}
            onKeyDown={handleRightKeyDown}
            onDoubleClick={() => !readOnly && setIsEditingRight(true)}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              cursor: readOnly ? 'default' : 'cell',
              userSelect: 'none',
              outline: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {rightState ? formatCurrency(rightState) : <span className="cell-placeholder"><IndianRupee size={11} /> Amount</span>}
          </div>
        )}
      </div>
    </div>
  );
});

// Currency cell: shows ₹ formatted display, edits as raw number
const CurrencyCell = React.memo(({ idx, col, entry, colIdx, totalRows, visibleColumns, handleCellChange, onKeyDown, readOnly, scrollToColumn, registerId, currentUserName, currentUserId, cellLock }: SpreadsheetTextInputProps & { onKeyDown?: (e: React.KeyboardEvent) => void }) => {
  const rawValue = entry.cells?.[col.id.toString()] || '';
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(rawValue);
  const valRef = useRef(rawValue);
  const isEditingRef = useRef(false);
  const liveTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLockedByOther = !!cellLock;
  const effectiveReadOnly = readOnly || isLockedByOther;
  const latestCurrPropsRef = useRef({ rawValue, entryId: entry.id, colId: col.id.toString(), handleCellChange, effectiveReadOnly });
  latestCurrPropsRef.current = { rawValue, entryId: entry.id, colId: col.id.toString(), handleCellChange, effectiveReadOnly };

  useEffect(() => {
    isEditingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      setVal(rawValue);
      valRef.current = rawValue;
    }
  }, [rawValue, editing]);

  useEffect(() => {
    const flushPendingCurrencyEdit = () => {
      const snap = latestCurrPropsRef.current;
      if (isEditingRef.current && !snap.effectiveReadOnly && valRef.current !== snap.rawValue) {
        isEditingRef.current = false;
        snap.handleCellChange(snap.entryId, snap.colId, valRef.current);
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPendingCurrencyEdit();
    };
    window.addEventListener('pagehide', flushPendingCurrencyEdit);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flushPendingCurrencyEdit);
      document.removeEventListener('visibilitychange', onHide);
      if (liveTypingTimerRef.current) clearTimeout(liveTypingTimerRef.current);
      const wasEditing = isEditingRef.current;
      flushPendingCurrencyEdit();
      if (wasEditing && registerId !== undefined) {
        emitCellBlur(registerId, entry.id, String(col.id));
      }
    };
  }, [registerId, entry.id, col.id]);

  const flushLiveTyping = useCallback((nextVal: string) => {
    if (registerId === undefined) return;
    if (liveTypingTimerRef.current) {
      clearTimeout(liveTypingTimerRef.current);
      liveTypingTimerRef.current = null;
    }
    emitLiveTyping(registerId, entry.id, String(col.id), nextVal, currentUserName || 'User', currentUserId || 'anon');
  }, [registerId, entry.id, col.id, currentUserName, currentUserId]);

  const sendLiveTyping = useCallback((nextVal: string) => {
    if (registerId === undefined) return;
    if (nextVal === '') {
      flushLiveTyping('');
      return;
    }
    if (liveTypingTimerRef.current) clearTimeout(liveTypingTimerRef.current);
    liveTypingTimerRef.current = setTimeout(() => {
      emitLiveTyping(registerId, entry.id, String(col.id), nextVal, currentUserName || 'User', currentUserId || 'anon');
    }, 50);
  }, [registerId, entry.id, col.id, currentUserName, currentUserId, flushLiveTyping]);

  const startEditing = useCallback((initialChar?: string) => {
    if (isLockedByOther && cellLock) {
      toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
      return;
    }
    if (readOnly) return;
    isEditingRef.current = true;
    setEditing(true);
    if (registerId !== undefined) {
      emitCellFocus(registerId, entry.id, String(col.id), currentUserName || 'User', currentUserId || 'anon');
    }
    if (initialChar !== undefined) {
      setVal(initialChar);
      valRef.current = initialChar;
      sendLiveTyping(initialChar);
    }
  }, [isLockedByOther, cellLock, readOnly, registerId, entry.id, col.id, currentUserName, currentUserId, sendLiveTyping]);

  const stopEditing = useCallback((revert = false) => {
    if (liveTypingTimerRef.current) {
      clearTimeout(liveTypingTimerRef.current);
      liveTypingTimerRef.current = null;
    }
    isEditingRef.current = false;
    setEditing(false);
    if (revert) {
      setVal(rawValue);
      valRef.current = rawValue;
      if (registerId !== undefined) {
        emitLiveTyping(registerId, entry.id, String(col.id), rawValue, currentUserName || 'User', currentUserId || 'anon');
      }
    } else if (registerId !== undefined && valRef.current !== rawValue) {
      emitLiveTyping(registerId, entry.id, String(col.id), valRef.current, currentUserName || 'User', currentUserId || 'anon');
    }
    if (registerId !== undefined) {
      emitCellBlur(registerId, entry.id, String(col.id));
    }
  }, [rawValue, registerId, entry.id, col.id, currentUserName, currentUserId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { 
      stopEditing(true);
      e.currentTarget.blur(); 
      return;
    }

    const focusNext = (rowI: number, cId: number | string, cIdx: number) => {
      if (scrollToColumn) {
        scrollToColumn(cIdx);
      }
      setTimeout(() => {
        const el = document.getElementById(`cell-${rowI}-${cId}`) || document.querySelector(`[data-cell="cell-${rowI}-${cId}"]`) as HTMLElement;
        if (el) el.focus();
      }, 50);
    };

    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      stopEditing(false);
      if (e.shiftKey) {
        const prevCol = visibleColumns[colIdx - 1];
        if (prevCol) {
          focusNext(idx, prevCol.id, colIdx - 1);
        } else {
          const lastCol = visibleColumns[visibleColumns.length - 1];
          if (lastCol) focusNext(idx > 0 ? idx - 1 : totalRows - 1, lastCol.id, visibleColumns.length - 1);
        }
      } else {
        const nextCol = visibleColumns[colIdx + 1];
        if (nextCol) {
          focusNext(idx, nextCol.id, colIdx + 1);
        } else {
          const firstCol = visibleColumns[0];
          if (firstCol) focusNext(idx < totalRows - 1 ? idx + 1 : 0, firstCol.id, 0);
        }
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      if (idx > 0) {
        e.preventDefault();
        stopEditing(false);
        focusNext(idx - 1, col.id, colIdx);
      }
    } else if (e.key === 'ArrowDown') {
      if (idx < totalRows - 1) {
        e.preventDefault();
        stopEditing(false);
        focusNext(idx + 1, col.id, colIdx);
      }
    }
  }, [idx, col.id, visibleColumns, colIdx, totalRows, scrollToColumn, stopEditing]);

  if (editing && !effectiveReadOnly) {
    return (
      <input
        id={`cell-${idx}-${col.id}`}
        className="cell-input currency-editing"
        type="text"
        inputMode="decimal"
        value={val}
        autoFocus
        onChange={(e) => {
          const nextVal = e.target.value;
          valRef.current = nextVal;
          setVal(nextVal);
          sendLiveTyping(nextVal);
        }}
        onBlur={() => {
          const wasEditing = isEditingRef.current;
          const finalVal = valRef.current;
          stopEditing(false);
          if (wasEditing && finalVal !== rawValue) {
            handleCellChange(entry.id, col.id.toString(), finalVal);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Tab') {
            if (valRef.current !== rawValue) {
              handleCellChange(entry.id, col.id.toString(), valRef.current);
            }
          }
          handleKeyDown(e);
        }}
        placeholder="0.00"
      />
    );
  }

  return (
    <div
      data-cell={`cell-${idx}-${col.id}`}
      id={`cell-${idx}-${col.id}`}
      tabIndex={readOnly ? -1 : 0}
      className={`cell-currency ${effectiveReadOnly ? 'cell-readonly' : ''}`}
      onDoubleClick={() => startEditing()}
      onKeyDown={(e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          if (isLockedByOther && cellLock) {
            toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
            return;
          }
          if (!effectiveReadOnly && (valRef.current !== '' || rawValue !== '')) {
            valRef.current = '';
            setVal('');
            flushLiveTyping('');
            handleCellChange(entry.id, col.id.toString(), '');
          }
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          startEditing();
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          startEditing(e.key);
        } else {
          onKeyDown?.(e);
        }
      }}
      title={isLockedByOther ? `Locked by ${cellLock?.userName}` : (readOnly ? "" : "Double click to edit")}
    >
      {rawValue ? formatCurrency(rawValue) : <span className="cell-placeholder"><IndianRupee size={11} /> Amount</span>}
    </div>
  );
});

const SpreadsheetTextInput = React.memo(({ idx, col, entry, visibleColumns, colIdx, totalRows, handleCellChange, type = 'text', placeholder, searchTerm, readOnly, suggestions, scrollToColumn, onOpenDatePicker, registerId, currentUserName, currentUserId, cellLock }: SpreadsheetTextInputProps & { onOpenDatePicker?: (rect?: DOMRect) => void }) => {
  let initialValue = entry.cells?.[col.id.toString()] || '';
  if (col.type === 'date' && initialValue.includes('/')) {
    initialValue = initialValue.replace(/\//g, '-');
  }
  const [val, setVal] = useState(initialValue);
  const valRef = useRef(initialValue);
  const [focused, setFocused] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditingRef = useRef(false);
  const liveTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const isLockedByOther = !!cellLock;
  const effectiveReadOnly = readOnly || isLockedByOther;
  const latestTextPropsRef = useRef({ initialValue, entryId: entry.id, colId: col.id.toString(), handleCellChange, effectiveReadOnly });
  latestTextPropsRef.current = { initialValue, entryId: entry.id, colId: col.id.toString(), handleCellChange, effectiveReadOnly };

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  useEffect(() => {
    const flushPendingTextEdit = () => {
      const snap = latestTextPropsRef.current;
      if (isEditingRef.current && !snap.effectiveReadOnly && valRef.current !== snap.initialValue) {
        isEditingRef.current = false;
        snap.handleCellChange(snap.entryId, snap.colId, valRef.current);
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPendingTextEdit();
    };
    window.addEventListener('pagehide', flushPendingTextEdit);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flushPendingTextEdit);
      document.removeEventListener('visibilitychange', onHide);
      if (liveTypingTimerRef.current) clearTimeout(liveTypingTimerRef.current);
      const wasEditing = isEditingRef.current;
      flushPendingTextEdit();
      if (wasEditing && registerId !== undefined) {
        emitCellBlur(registerId, entry.id, String(col.id));
      }
    };
  }, [registerId, entry.id, col.id]);

  const flushLiveTyping = useCallback((nextVal: string) => {
    if (registerId === undefined) return;
    if (liveTypingTimerRef.current) {
      clearTimeout(liveTypingTimerRef.current);
      liveTypingTimerRef.current = null;
    }
    emitLiveTyping(registerId, entry.id, String(col.id), nextVal, currentUserName || 'User', currentUserId || 'anon');
  }, [registerId, entry.id, col.id, currentUserName, currentUserId]);

  const sendLiveTyping = useCallback((nextVal: string) => {
    if (registerId === undefined) return;
    if (nextVal === '') {
      flushLiveTyping('');
      return;
    }
    if (liveTypingTimerRef.current) clearTimeout(liveTypingTimerRef.current);
    liveTypingTimerRef.current = setTimeout(() => {
      emitLiveTyping(registerId, entry.id, String(col.id), nextVal, currentUserName || 'User', currentUserId || 'anon');
    }, 50);
  }, [registerId, entry.id, col.id, currentUserName, currentUserId, flushLiveTyping]);

  const enterEditMode = useCallback((initialChar?: string) => {
    if (isLockedByOther && cellLock) {
      toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
      return;
    }
    if (readOnly) return;
    isEditingRef.current = true;
    setIsEditing(true);
    setFocused(true);
    if (registerId !== undefined) {
      emitCellFocus(registerId, entry.id, String(col.id), currentUserName || 'User', currentUserId || 'anon');
    }
    if (initialChar !== undefined) {
      valRef.current = initialChar;
      setVal(initialChar);
      sendLiveTyping(initialChar);
    }
  }, [isLockedByOther, cellLock, readOnly, registerId, entry.id, col.id, currentUserName, currentUserId, sendLiveTyping]);

  // Compute filtered suggestions
  const filteredSuggestions = useMemo(() => {
    if (!focused || !val || val.length < 3 || effectiveReadOnly || isDeleting || !suggestions || suggestions.length === 0) return [];
    const lower = val.toLowerCase();
    return suggestions.filter(s => s.toLowerCase().includes(lower) && s.toLowerCase() !== lower);
  }, [val, suggestions, focused, effectiveReadOnly, isDeleting]);

  const showDropdown = filteredSuggestions.length > 0 && focused;

  // Update dropdown position when it should be shown
  useEffect(() => {
    if (showDropdown && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 160) });
    } else {
      setDropdownPos(null);
    }
  }, [showDropdown, val]);

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightIdx(-1);
  }, [filteredSuggestions.length, val]);

  // Sync only when not actively editing locally so echoes/remote events don't interrupt active typing
  useEffect(() => {
    if (!isEditing) {
      valRef.current = initialValue;
      setVal(initialValue);
      setIsDeleting(false);
    }
  }, [initialValue, isEditing]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (effectiveReadOnly) return;
    const newVal = e.target.value;
    setIsDeleting(newVal.length < valRef.current.length);
    valRef.current = newVal;
    setVal(newVal);
    sendLiveTyping(newVal);
  }, [effectiveReadOnly, sendLiveTyping]);

  const selectSuggestion = useCallback((suggestion: string) => {
    valRef.current = suggestion;
    setVal(suggestion);
    isEditingRef.current = false;
    setIsEditing(false);
    setFocused(false);
    setHighlightIdx(-1);
    const prevVal = entry.cells?.[col.id.toString()] || '';
    if (suggestion !== prevVal) {
      flushLiveTyping(suggestion);
      handleCellChange(entry.id, col.id.toString(), suggestion);
    }
    if (registerId !== undefined) {
      emitCellBlur(registerId, entry.id, String(col.id));
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [entry, col.id, handleCellChange, registerId, flushLiveTyping]);

  const onBlur = useCallback(() => {
    // Delay to allow click on dropdown item
    setTimeout(() => {
      if (liveTypingTimerRef.current) {
        clearTimeout(liveTypingTimerRef.current);
        liveTypingTimerRef.current = null;
      }
      const wasEditing = isEditingRef.current;
      isEditingRef.current = false;
      setFocused(false);
      setIsEditing(false);
      setIsDeleting(false);
      setHighlightIdx(-1);
      if (!wasEditing) return;
      if (effectiveReadOnly) {
        if (registerId !== undefined) emitCellBlur(registerId, entry.id, String(col.id));
        return;
      }

      const finalVal = valRef.current;
      const prevVal = entry.cells?.[col.id.toString()] || '';
      if (finalVal !== prevVal) {
        flushLiveTyping(finalVal);
        const success = handleCellChange(entry.id, col.id.toString(), finalVal);
        if (success === false) {
          valRef.current = prevVal;
          setVal(prevVal);
          flushLiveTyping(prevVal);
        }
      }
      if (registerId !== undefined) {
        emitCellBlur(registerId, entry.id, String(col.id));
      }
    }, 150);
  }, [entry, col.id, handleCellChange, effectiveReadOnly, registerId, flushLiveTyping]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<any>) => {
    if (col.type === 'date') {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (isLockedByOther && cellLock) {
          toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
          return;
        }
        if (onOpenDatePicker) {
          const rect = inputRef.current?.getBoundingClientRect() || (e.currentTarget as HTMLElement).getBoundingClientRect();
          onOpenDatePicker(rect);
        }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (isLockedByOther && cellLock) {
          toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
          return;
        }
        if (!effectiveReadOnly) {
          const curVal = entry.cells?.[col.id.toString()] || '';
          if (valRef.current !== '' || curVal !== '') {
            valRef.current = '';
            setVal('');
            flushLiveTyping('');
            handleCellChange(entry.id, col.id.toString(), '');
          }
        }
        return;
      }
    }

    if (e.key === 'Escape') {
      if (liveTypingTimerRef.current) {
        clearTimeout(liveTypingTimerRef.current);
        liveTypingTimerRef.current = null;
      }
      const prevVal = entry.cells?.[col.id.toString()] || '';
      isEditingRef.current = false;
      setFocused(false);
      setIsEditing(false);
      setHighlightIdx(-1);
      valRef.current = prevVal;
      setVal(prevVal);
      if (registerId !== undefined) {
        emitLiveTyping(registerId, entry.id, String(col.id), prevVal, currentUserName || 'User', currentUserId || 'anon');
        emitCellBlur(registerId, entry.id, String(col.id));
      }
      e.currentTarget.blur();
      return;
    }

    const focusNext = (rowI: number, cId: number | string, cIdx: number) => {
      if (scrollToColumn) {
        scrollToColumn(cIdx);
      }
      setTimeout(() => {
        const el = document.getElementById(`cell-${rowI}-${cId}`) || document.querySelector(`[data-cell="cell-${rowI}-${cId}"]`) as HTMLElement;
        if (el) el.focus();
      }, 50);
    };

    // If dropdown is showing, ArrowDown/ArrowUp navigate suggestions
    if (showDropdown && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      e.stopPropagation();
      setHighlightIdx(prev => {
        const max = filteredSuggestions.length;
        if (e.key === 'ArrowDown') return prev < max - 1 ? prev + 1 : 0;
        return prev > 0 ? prev - 1 : max - 1;
      });
      return;
    }

    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();

      // If a suggestion is highlighted, select it instead of navigating
      if (showDropdown && highlightIdx >= 0 && highlightIdx < filteredSuggestions.length) {
        selectSuggestion(filteredSuggestions[highlightIdx]);
        return;
      }

      if (liveTypingTimerRef.current) {
        clearTimeout(liveTypingTimerRef.current);
        liveTypingTimerRef.current = null;
      }
      const wasEditing = isEditingRef.current;
      const finalVal = valRef.current;
      const prevVal = entry.cells?.[col.id.toString()] || '';
      if (wasEditing && !effectiveReadOnly && finalVal !== prevVal) {
        flushLiveTyping(finalVal);
        const success = handleCellChange(entry.id, col.id.toString(), finalVal);
        if (success === false) {
          valRef.current = prevVal;
          setVal(prevVal);
          flushLiveTyping(prevVal);
          return;
        }
      }
      isEditingRef.current = false;
      if (wasEditing && registerId !== undefined) {
        emitCellBlur(registerId, entry.id, String(col.id));
      }
      setFocused(false);
      setIsEditing(false);
      setHighlightIdx(-1);
      if (e.shiftKey) {
        const prevCol = visibleColumns[colIdx - 1];
        if (prevCol) {
          focusNext(idx, prevCol.id, colIdx - 1);
        } else {
          const lastCol = visibleColumns[visibleColumns.length - 1];
          if (lastCol) focusNext(idx > 0 ? idx - 1 : totalRows - 1, lastCol.id, visibleColumns.length - 1);
        }
      } else {
        const nextCol = visibleColumns[colIdx + 1];
        if (nextCol) {
          focusNext(idx, nextCol.id, colIdx + 1);
        } else {
          const firstCol = visibleColumns[0];
          if (firstCol) focusNext(idx < totalRows - 1 ? idx + 1 : 0, firstCol.id, 0);
        }
      }
      return;
    }

    // Clear cell value in display mode on Delete/Backspace and sync immediately
    if (!isEditing && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      if (isLockedByOther && cellLock) {
        toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
        return;
      }
      if (!effectiveReadOnly) {
        const curVal = entry.cells?.[col.id.toString()] || '';
        if (valRef.current !== '' || curVal !== '') {
          valRef.current = '';
          setVal('');
          flushLiveTyping('');
          handleCellChange(entry.id, col.id.toString(), '');
        }
      }
      return;
    }

    // Enable edit mode when user starts typing printable characters
    if (!isEditing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      enterEditMode(e.key);
      return;
    }

    // Enable edit mode on Enter
    if (!isEditing && e.key === 'Enter') {
      e.preventDefault();
      enterEditMode();
      return;
    }

    // Arrow navigation when NOT actively editing text
    if (!isEditing) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevCol = visibleColumns[colIdx - 1];
        if (prevCol) {
          focusNext(idx, prevCol.id, colIdx - 1);
        } else if (idx > 0) {
          const lastCol = visibleColumns[visibleColumns.length - 1];
          if (lastCol) focusNext(idx - 1, lastCol.id, visibleColumns.length - 1);
        }
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextCol = visibleColumns[colIdx + 1];
        if (nextCol) {
          focusNext(idx, nextCol.id, colIdx + 1);
        } else if (idx < totalRows - 1) {
          const firstCol = visibleColumns[0];
          if (firstCol) focusNext(idx + 1, firstCol.id, 0);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        if (idx < totalRows - 1) {
          e.preventDefault();
          focusNext(idx + 1, col.id, colIdx);
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        if (idx > 0) {
          e.preventDefault();
          focusNext(idx - 1, col.id, colIdx);
        }
        return;
      }
    }
  }, [idx, col.id, col.type, visibleColumns, colIdx, totalRows, effectiveReadOnly, isLockedByOther, cellLock, entry, handleCellChange, showDropdown, highlightIdx, filteredSuggestions, selectSuggestion, scrollToColumn, isEditing, enterEditMode, onOpenDatePicker, registerId, currentUserName, currentUserId, flushLiveTyping]);

  const hasHighlight = !!searchTerm && !!val && val.toLowerCase().includes(searchTerm.toLowerCase());

  const handleFocus = useCallback(() => !effectiveReadOnly && setFocused(true), [effectiveReadOnly]);


  if (!isEditing) {
    return (
      <div
        id={`cell-${idx}-${col.id}`}
        data-cell={`cell-${idx}-${col.id}`}
        className={`cell-input cell-display-mode ${effectiveReadOnly ? 'cell-readonly' : ''} ${hasHighlight && !focused ? 'cell-input-highlight-wrap' : ''}`}
        tabIndex={readOnly ? -1 : 0}
        onFocus={handleFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          if (col.type === 'date' && onOpenDatePicker) {
            if (isLockedByOther && cellLock) {
              toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
              return;
            }
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onOpenDatePicker(rect);
          }
        }}
        onDoubleClick={(e) => {
          if (col.type === 'date') {
            if (isLockedByOther && cellLock) {
              toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
              return;
            }
            if (onOpenDatePicker) {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onOpenDatePicker(rect);
            }
            return;
          }
          enterEditMode();
        }}
        title={isLockedByOther ? `Locked by ${cellLock?.userName}` : undefined}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          cursor: col.type === 'date' ? (effectiveReadOnly ? 'default' : 'pointer') : (effectiveReadOnly ? 'default' : 'cell'),
          userSelect: 'none',
          outline: 'none',
        }}
      >
        {hasHighlight && !focused ? (
          <HighlightedText text={val} searchTerm={searchTerm} />
        ) : (
          val || <span className="cell-placeholder" style={{ opacity: 0.4 }}>—</span>
        )}
      </div>
    );
  }

  return (
    <>
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
      <input
        ref={inputRef}
        id={`cell-${idx}-${col.id}`}
        className={`cell-input ${effectiveReadOnly ? 'cell-readonly' : ''}`}
        value={val}
        onChange={onChange}
        onBlur={onBlur}
        onFocus={handleFocus}
        onKeyDown={onKeyDown}
        type={type}
        placeholder={placeholder}
        inputMode={col.type === 'number' ? 'decimal' : undefined}
        autoComplete="off"
        readOnly={effectiveReadOnly}
        autoFocus
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box'
        }}
      />
      {showDropdown && dropdownPos && createPortal(
        <div
          className="cell-suggestions-dropdown"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 10010,
          }}
        >
          {filteredSuggestions.slice(0, 8).map((s, i) => {
            const matchIdx = s.toLowerCase().indexOf(val.toLowerCase());
            return (
              <div
                key={s}
                className={`cell-suggestion-item ${i === highlightIdx ? 'highlighted' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(s);
                }}
                onMouseEnter={() => setHighlightIdx(i)}
              >
                {matchIdx >= 0 ? (
                  <>
                    {s.slice(0, matchIdx)}
                    <strong>{s.slice(matchIdx, matchIdx + val.length)}</strong>
                    {s.slice(matchIdx + val.length)}
                  </>
                ) : s}
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
    </>
  );
});

interface SpreadsheetRowProps {
  entry: Entry;
  idx: number;
  visibleColumns: Column[];
  /** The virtual columns from TanStack Virtual */
  virtualCols?: any[];
  /** Frozen columns before virtual window */
  beforeVirtualCols?: { index: number }[];
  /** Frozen columns after virtual window */
  afterVirtualCols?: { index: number }[];
  /** Horizontal left padding (px) to represent off-screen columns left of viewport */
  paddingLeft?: number;
  /** Horizontal right padding (px) to represent off-screen columns right of viewport */
  paddingRight?: number;
  /** Fixed row height for virtualized stability */
  rowHeight?: number;
  isSelected: boolean;
  toggleSelectRow: (id: number) => void;
  totalRows: number;
  handleCellChange: (entryId: number, columnId: string, value: string) => void;
  openDatePicker: (entryId: number, colId: number, currentVal: string, rect?: DOMRect) => void;
  openDropdown: (entryId: number, colId: number, options: string[], rect?: DOMRect) => void;
  isMenuOpen: boolean;
  toggleMenu: (id: number) => void;
  registerColumns: Column[];
  onRowDetail?: (entry: Entry) => void;
  onImagePreview?: (data: { url: string; entryId: number; colId: string }) => void;
  onOpenSignaturePad?: (entryId: number, colId: number, currentSignature: string, columnName: string) => void;
  frozenColumns?: Set<number>;
  frozenLeftOffsets?: Record<number, number>;
  colWidths?: Record<number, number>;
  defaultColWidth?: number;
  onCellFormatClick?: (entryId: number, colId: string, rect: DOMRect) => void;
  searchTerm?: string;
  editableColumnIds?: Set<number> | null;
  rowEditRange?: { start?: number; end?: number } | null;
  columnSuggestions?: Record<string, string[]>;
  displayRowNumber?: number;
  scrollToColumn?: (colIdx: number) => void;
  /** Called when an inline image upload starts (compression begins) */
  onImageUploadStart?: () => void;
  /** Called when an inline image upload ends (compression + handleCellChange done) */
  onImageUploadEnd?: () => void;
  savingCells?: Set<string>;
  highlightedRowId?: number | null;
  lockedCells?: Map<string, any>;
  registerId?: number | string;
  currentUserName?: string;
  currentUserId?: string | number;
  cellLock?: CellLockInfo | null;
}

export const SpreadsheetRow = React.memo(function SpreadsheetRow(props: SpreadsheetRowProps) {
  const {
    entry,
    idx,
    visibleColumns,
    virtualCols,
    beforeVirtualCols,
    afterVirtualCols,
    paddingLeft = 0,
    paddingRight = 0,
    rowHeight,
    totalRows,
    handleCellChange,
    openDatePicker,
    openDropdown,
    isMenuOpen,
    toggleMenu,
    registerColumns,
    onRowDetail,
    onImagePreview,
    frozenColumns,
    frozenLeftOffsets,
    colWidths,
    defaultColWidth = 150,
    onCellFormatClick,
    searchTerm,
    editableColumnIds,
    rowEditRange,
    columnSuggestions,
    displayRowNumber,
    scrollToColumn,
    highlightedRowId,
    lockedCells,
    registerId,
    currentUserName,
    currentUserId,
  } = props;
  const { reminders } = useNotifications();
  const [uploadingImageCols, setUploadingImageCols] = useState<Record<number, boolean>>({});
  const [peekHiddenCols, setPeekHiddenCols] = useState<Record<string, boolean>>({});
  const hasPendingReminder = useMemo(() => {
    return reminders.some(r => r.rowId === entry.id && r.status === 'Pending' && r.registerId === String(entry.registerId));
  }, [reminders, entry.id, entry.registerId]);

  const elements: { type: 'cell' | 'pad-left' | 'pad-right', vc?: { index: number } }[] = [];
  if (virtualCols && beforeVirtualCols && afterVirtualCols) {
    beforeVirtualCols.forEach(vc => elements.push({ type: 'cell', vc }));
    if (paddingLeft > 0) elements.push({ type: 'pad-left' });
    virtualCols.forEach(vc => elements.push({ type: 'cell', vc }));
    if (paddingRight > 0) elements.push({ type: 'pad-right' });
    afterVirtualCols.forEach(vc => elements.push({ type: 'cell', vc }));
  } else {
    visibleColumns.forEach((_, i) => elements.push({ type: 'cell', vc: { index: i } }));
  }


  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, colId: number | string, colIdx: number) => {
    if (e.key === 'Escape') {
      if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
      return;
    }

    const focusNext = (rowI: number, cId: number | string, cIdx: number) => {
      if (scrollToColumn) {
        scrollToColumn(cIdx);
      }
      setTimeout(() => {
        const el = document.getElementById(`cell-${rowI}-${cId}`) || document.querySelector(`[data-cell="cell-${rowI}-${cId}"]`) as HTMLElement;
        if (el) el.focus();
      }, 50);
    };

    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        const prevCol = visibleColumns[colIdx - 1];
        if (prevCol) {
          focusNext(idx, prevCol.id, colIdx - 1);
        } else {
          const lastCol = visibleColumns[visibleColumns.length - 1];
          if (lastCol) focusNext(idx > 0 ? idx - 1 : totalRows - 1, lastCol.id, visibleColumns.length - 1);
        }
      } else {
        const nextCol = visibleColumns[colIdx + 1];
        if (nextCol) {
          focusNext(idx, nextCol.id, colIdx + 1);
        } else {
          const firstCol = visibleColumns[0];
          if (firstCol) focusNext(idx < totalRows - 1 ? idx + 1 : 0, firstCol.id, 0);
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusNext(idx + 1, colId, colIdx);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusNext(idx - 1, colId, colIdx);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevCol = visibleColumns[colIdx - 1];
      if (prevCol) {
        focusNext(idx, prevCol.id, colIdx - 1);
      } else if (idx > 0) {
        const lastCol = visibleColumns[visibleColumns.length - 1];
        if (lastCol) focusNext(idx - 1, lastCol.id, visibleColumns.length - 1);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextCol = visibleColumns[colIdx + 1];
      if (nextCol) {
        focusNext(idx, nextCol.id, colIdx + 1);
      } else if (idx < totalRows - 1) {
        const firstCol = visibleColumns[0];
        if (firstCol) focusNext(idx + 1, firstCol.id, 0);
      }
    }
  }, [idx, visibleColumns, totalRows, scrollToColumn]);

  const handleSerialClick = useCallback(() => {
    onRowDetail?.(entry);
  }, [entry, onRowDetail]);
  const { isSelected, toggleSelectRow } = props;

  const handleCheckboxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    toggleSelectRow(entry.id);
  }, [entry.id, toggleSelectRow]);

  const isHighlighted = entry.id === highlightedRowId;
  const rowClassName = [
    isSelected ? 'row-selected' : '',
    isHighlighted ? 'row-highlight-pulse' : ''
  ].filter(Boolean).join(' ');

  return (
    <tr id={`row-${entry.id}`} data-entry-id={entry.id} className={rowClassName} style={rowHeight ? { height: rowHeight, maxHeight: rowHeight } : undefined}>
      <td 
        className="serial" 
        style={{ cursor: 'pointer', position: 'sticky', left: 0, zIndex: 16, background: '#ffffff', backgroundColor: '#ffffff', borderRight: '1px solid #e2e8f0' }}
        onClick={handleSerialClick}
        title="Click to view details"
      >
        <div className="serial-inner">
          <button
            className={`row-menu-btn ${isMenuOpen ? 'menu-open' : ''}`}
            aria-label="Row Options"
            title="Row Options"
            onClick={(e) => {
              e.stopPropagation();
              toggleMenu(entry.id);
            }}
          >
            <span style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-1px', lineHeight: 1 }}>⋮</span>
          </button>
          <input
            type="checkbox"
            className="row-select-checkbox"
            checked={isSelected}
            onChange={handleCheckboxChange}
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
          />
          <span className="serial-number">{displayRowNumber || entry.rowNumber}</span>
          {hasPendingReminder && (
          <span title="This row has a pending reminder">
            <Bell 
              size={12} 
              className="text-amber-500 fill-amber-500 animate-pulse" 
              style={{ 
                color: '#f59e0b',
                fill: '#f59e0b',
                marginLeft: '2px',
                flexShrink: 0
              }} 
            />
          </span>
          )}
        </div>
      </td>
      {elements.map((el) => {
        if (el.type === 'pad-left') {
          return <td key="pad-left" className="spacer" style={{ width: paddingLeft, minWidth: paddingLeft, padding: 0, border: 'none' }} />;
        }
        if (el.type === 'pad-right') {
          return <td key="pad-right" className="spacer" style={{ width: paddingRight, minWidth: paddingRight, padding: 0, border: 'none' }} />;
        }

        const vc = el.vc!;
        const col = visibleColumns[vc.index];
        if (!col) return null;
        
        const colIdx = vc.index; // Absolute index for navigation
        const isFrozen = frozenColumns?.has(col.id);
        const isSavingCell = props.savingCells?.has(`${entry.id}-${col.id}`);
        const w = colWidths?.[col.id] || defaultColWidth;
        const cs = entry.cellStyles?.[col.id.toString()];
        let cellStyle: React.CSSProperties = { width: w, minWidth: w, maxWidth: w };
        
        // Apply column-level background styling if present
        if (col.bgColor) cellStyle.background = col.bgColor;
        
        // Apply user-defined cell formatting (overrides column-level styles)
        if (cs?.bgColor) cellStyle.background = cs.bgColor;
        if (cs?.textColor) cellStyle.color = cs.textColor;
        if (cs?.textAlign) cellStyle.textAlign = cs.textAlign;
        
        if (isFrozen) {
          const left = frozenLeftOffsets?.[col.id] ?? 64;
          const frozenBg = cs?.bgColor 
            ? cs.bgColor 
            : (col.bgColor ? `linear-gradient(${col.bgColor}, ${col.bgColor}), #ffffff` : '#ffffff');
          cellStyle = { 
            ...cellStyle, 
            position: 'sticky', 
            left, 
            zIndex: 12, 
            background: frozenBg,
            backgroundColor: cs?.bgColor || (col.bgColor ? undefined : '#ffffff'),
            boxShadow: '3px 0 8px -2px rgba(15, 23, 42, 0.08)'
          };
        }
        
        const isRowEditableByRange = !rowEditRange || (
          (rowEditRange.start === undefined || entry.rowNumber >= rowEditRange.start) &&
          (rowEditRange.end === undefined || entry.rowNumber <= rowEditRange.end)
        );
        const isEditable = isRowEditableByRange && (!editableColumnIds || editableColumnIds.has(col.id));
        const cellLock = lockedCells?.get(`${entry.id}-${col.id}`) || null;
        const isLockedByOther = !!cellLock;
        const canEditCell = isEditable && !isLockedByOther;
        const isCellHidden = !!cs?.hidden;
        const isCellRevealed = isEditable && !!peekHiddenCols[col.id.toString()];
        if (isLockedByOther && cellLock) {
          cellStyle = {
            ...cellStyle,
            outline: `2px solid ${cellLock.color}`,
            outlineOffset: '-2px',
          };
        }
        
        const handleContextMenu = (e: React.MouseEvent) => {
          e.preventDefault();
          if (onCellFormatClick && canEditCell) {
            onCellFormatClick(entry.id, col.id.toString(), (e.currentTarget as HTMLElement).getBoundingClientRect());
          }
        };
        
        return (
        <td key={col.id} className={isFrozen ? 'frozen-col' : ''} style={cellStyle} onContextMenu={handleContextMenu}>
          <div className="cell-inner-wrapper" style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flex: 1 }}>
          {isLockedByOther && cellLock && (
            <div
              style={{
                position: 'absolute',
                top: '1px',
                right: '2px',
                zIndex: 15,
                pointerEvents: 'none',
                background: cellLock.color,
                color: '#ffffff',
                fontSize: '9px',
                fontWeight: 700,
                lineHeight: 1.2,
                padding: '1px 5px',
                borderRadius: '4px',
                maxWidth: '90px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
              }}
              title={`${cellLock.userName} is currently editing`}
            >
              {cellLock.userName}
            </div>
          )}
          {isSavingCell && (
            <div className="cell-saving-indicator" style={{
              position: 'absolute',
              right: '6px',
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              pointerEvents: 'none',
              background: 'var(--table-bg)',
              padding: '2px',
              borderRadius: '50%'
            }} title="Saving changes...">
              <span className="spinner dark" style={{ width: '10px', height: '10px', borderWidth: '1.5px', display: 'inline-block' }} />
            </div>
          )}
          {isCellHidden && !isCellRevealed ? (
            <div
              data-cell={`cell-${idx}-${col.id}`}
              tabIndex={isEditable ? 0 : -1}
              onKeyDown={(e) => handleCellKeyDown(e, col.id, colIdx)}
              onDoubleClick={() => {
                if (canEditCell) {
                  setPeekHiddenCols(prev => ({ ...prev, [col.id.toString()]: true }));
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                width: '100%',
                height: '100%',
                padding: '0 8px',
                color: '#64748b',
                fontSize: '12px',
                letterSpacing: '2px',
                userSelect: 'none',
                cursor: canEditCell ? 'pointer' : 'default',
              }}
              title={canEditCell ? 'Cell value hidden — right-click to reveal permanently, or double-click / click eye to peek' : 'Hidden cell'}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', opacity: 0.75 }}>
                <EyeOff size={11} style={{ flexShrink: 0, letterSpacing: 0 }} />
                <span>••••••</span>
              </span>
              {canEditCell && (
                <button
                  type="button"
                  tabIndex={-1}
                  title="Temporarily peek hidden value"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPeekHiddenCols(prev => ({ ...prev, [col.id.toString()]: true }));
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    background: 'rgba(99, 102, 241, 0.1)',
                    color: '#4F46E5',
                    borderRadius: '4px',
                    padding: '2px 4px',
                    cursor: 'pointer',
                    flexShrink: 0,
                    letterSpacing: 0,
                  }}
                >
                  <Eye size={11} />
                </button>
              )}
            </div>
          ) : (
          <>
          {isCellHidden && isCellRevealed && (
            <button
              type="button"
              tabIndex={-1}
              title="Re-mask hidden cell"
              onClick={(e) => {
                e.stopPropagation();
                setPeekHiddenCols(prev => ({ ...prev, [col.id.toString()]: false }));
              }}
              style={{
                position: 'absolute',
                top: '2px',
                left: '2px',
                zIndex: 14,
                border: 'none',
                background: 'rgba(79, 70, 229, 0.12)',
                color: '#4F46E5',
                borderRadius: '4px',
                padding: '1px 4px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <EyeOff size={10} />
            </button>
          )}
          {col.type === 'formula' ? (
            <FormulaCell idx={idx} col={col} entry={entry} registerColumns={registerColumns} onKeyDown={(e) => handleCellKeyDown(e, col.id, colIdx)} />
          ) : col.type === 'date' ? (
            <div 
              className="cell-url-wrap cell-date-wrap"
              style={{ cursor: canEditCell ? 'pointer' : 'default' }}
              onClick={isEditable ? (e) => {
                if (isLockedByOther && cellLock) {
                  toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
                  return;
                }
                openDatePicker(entry.id, col.id, entry.cells?.[col.id.toString()] || '', e.currentTarget.getBoundingClientRect());
              } : undefined}
            >
              {typeof entry.cells?.[col.id.toString()] === 'string' && entry.cells[col.id.toString()].includes(' ||| ') ? (
                <SplitTextInput
                  idx={idx} col={col} entry={entry} visibleColumns={visibleColumns} colIdx={colIdx} totalRows={totalRows} handleCellChange={handleCellChange}
                  placeholder="DD-MM-YYYY" readOnly={!canEditCell} scrollToColumn={scrollToColumn}
                />
              ) : (
                <SpreadsheetTextInput 
                  idx={idx} col={col} entry={entry} visibleColumns={visibleColumns} colIdx={colIdx} totalRows={totalRows} handleCellChange={handleCellChange}
                  placeholder="DD-MM-YYYY" searchTerm={searchTerm}
                  readOnly={!isEditable}
                  scrollToColumn={scrollToColumn}
                  registerId={registerId}
                  currentUserName={currentUserName}
                  currentUserId={currentUserId}
                  cellLock={cellLock}
                  onOpenDatePicker={isEditable ? (rect: any) => openDatePicker(entry.id, col.id, entry.cells?.[col.id.toString()] || '', rect) : undefined}
                />
              )}
              {canEditCell && (
                <button 
                  className="cell-url-link cell-date-picker-btn" 
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openDatePicker(entry.id, col.id, entry.cells?.[col.id.toString()] || '', e.currentTarget.getBoundingClientRect());
                  }}
                  tabIndex={-1}
                >
                  <Calendar size={12} />
                </button>
              )}
            </div>
          ) : (col.type === 'dropdown' || col.type === 'yes_no' || col.type === 'status') ? (
            <div 
              data-cell={`cell-${idx}-${col.id}`} 
              tabIndex={isEditable ? 0 : -1} 
              className={`cell-dropdown ${!canEditCell ? 'cell-readonly' : ''}`} 
              onClick={isEditable ? (e) => {
                if (isLockedByOther && cellLock) {
                  toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
                  return;
                }
                let opts = col.dropdownOptions || [];
                if (col.type === 'yes_no' && opts.length === 0) opts = ['Yes', 'No'];
                if (col.type === 'status' && opts.length === 0) opts = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
                openDropdown(entry.id, col.id, opts, e.currentTarget.getBoundingClientRect());
              } : undefined} 
              onKeyDown={(e) => { 
                if (!isEditable) return;
                if (e.key === ' ' || e.key === 'Enter' && e.ctrlKey) { 
                  e.preventDefault();
                  if (isLockedByOther && cellLock) {
                    toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
                    return;
                  }
                  let opts = col.dropdownOptions || [];
                  if (col.type === 'yes_no' && opts.length === 0) opts = ['Yes', 'No'];
                  if (col.type === 'status' && opts.length === 0) opts = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
                  openDropdown(entry.id, col.id, opts, e.currentTarget.getBoundingClientRect()); 
                } else if (canEditCell && (e.key === 'Delete' || e.key === 'Backspace')) {
                  e.preventDefault();
                  if (entry.cells?.[col.id.toString()]) {
                    handleCellChange(entry.id, col.id.toString(), '');
                  }
                } else handleCellKeyDown(e, col.id, colIdx); 
              }}
            >
              {entry.cells?.[col.id.toString()] ? (
                (col.type === 'yes_no' || col.type === 'status' || (col.optionColors && Object.keys(col.optionColors).length > 0)) ? (
                  <OptionBadge col={col} value={entry.cells[col.id.toString()]} searchTerm={searchTerm} />
                ) : (
                  <HighlightedText text={entry.cells[col.id.toString()]} searchTerm={searchTerm} />
                )
              ) : (
                <span className="cell-placeholder"><ChevronDown size={12} /> {canEditCell ? 'Select' : '—'}</span>
              )}
            </div>
          ) : col.type === 'checkbox' ? (
            <div className={`cell-checkbox-wrap ${!canEditCell ? 'cell-readonly' : ''}`}>
              <input
                id={`cell-${idx}-${col.id}`}
                type="checkbox"
                className="cell-checkbox"
                disabled={!canEditCell}
                checked={entry.cells?.[col.id.toString()] === 'true'}
                onChange={(e) => handleCellChange(entry.id, col.id.toString(), e.target.checked ? 'true' : 'false')}
                onKeyDown={(e) => { if (e.key !== ' ') handleCellKeyDown(e, col.id, colIdx); }}
                title={isLockedByOther ? `Locked by ${cellLock?.userName}` : col.name}
              />
            </div>
          ) : col.type === 'rating' ? (
            <div data-cell={`cell-${idx}-${col.id}`} tabIndex={isEditable ? 0 : -1} className={`cell-rating ${!canEditCell ? 'cell-readonly' : ''}`} onKeyDown={(e) => {
              if (canEditCell && (e.key === 'Delete' || e.key === 'Backspace')) {
                e.preventDefault();
                if (entry.cells?.[col.id.toString()]) {
                  handleCellChange(entry.id, col.id.toString(), '');
                }
                return;
              }
              handleCellKeyDown(e, col.id, colIdx);
            }}>
              {[1, 2, 3, 4, 5].map(star => (
                <button 
                  key={star} 
                  disabled={!canEditCell}
                  className={`star-btn ${(parseInt(entry.cells?.[col.id.toString()] || '0') >= star) ? 'active' : ''}`} 
                  onClick={() => handleCellChange(entry.id, col.id.toString(), star.toString())} 
                  title={canEditCell ? `Rate ${star}` : `Rating: ${entry.cells?.[col.id.toString()] || '0'}`} 
                  tabIndex={-1}
                >★</button>
              ))}
            </div>
          ) : col.type === 'image' ? (
            <div 
              data-cell={`cell-${idx}-${col.id}`} 
              tabIndex={0} 
              className="cell-image-wrap" 
              onKeyDown={(e) => handleCellKeyDown(e, col.id, colIdx)}
              onClick={() => {
                if (uploadingImageCols[col.id]) return; // block preview during active uploading
                const val = entry.cells?.[col.id.toString()];
                if (val) onImagePreview?.({ url: val, entryId: entry.id, colId: col.id.toString() });
              }}
              title={uploadingImageCols[col.id] ? "Compressing & Uploading image..." : (entry.cells?.[col.id.toString()] ? "Click to view full image" : (canEditCell ? "No image" : ""))}
            >
              {uploadingImageCols[col.id] ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '4px' }}>
                  <span className="spinner" style={{ width: '10px', height: '10px', border: '2px solid rgba(0,0,0,0.1)', borderLeftColor: 'var(--primary)', borderRadius: '50%', display: 'inline-block' }} />
                  <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--primary)' }}>Uploading...</span>
                </span>
              ) : entry.cells?.[col.id.toString()] ? (
                (() => {
                  const val = entry.cells[col.id.toString()];
                  const images = val.split('|||').filter(Boolean);
                  const firstImage = images[0];
                  const extraCount = images.length - 1;
                  return (
                    <div className="cell-image-inner" style={{ position: 'relative' }}>
                       <img 
                         src={firstImage} 
                         alt="img" 
                         className="cell-image-thumb" 
                       />
                       {extraCount > 0 && (
                         <div className="cell-image-badge" style={{
                           position: 'absolute',
                           top: '-4px',
                           right: '-4px',
                           background: 'var(--navy)',
                           color: 'white',
                           fontSize: '10px',
                           fontWeight: 'bold',
                           padding: '2px 4px',
                           borderRadius: '4px',
                           zIndex: 2,
                           boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                         }}>
                           +{extraCount}
                         </div>
                       )}
                       <div className="cell-image-overlay">
                         <Maximize2 size={12} />
                       </div>
                    </div>
                  );
                })()
              ) : (
                canEditCell ? (
                  <label className="cell-image-upload" title="Upload image" onClick={(e) => e.stopPropagation()}>
                     {uploadingImageCols[col.id] ? (
                       <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                         <span className="spinner" style={{ width: '10px', height: '10px', border: '2px solid rgba(0,0,0,0.1)', borderLeftColor: 'var(--primary)', borderRadius: '50%', display: 'inline-block' }} />
                         <span style={{ fontSize: '10px' }}>Uploading...</span>
                       </span>
                     ) : 'Add'}
                    <input type="file" accept="image/*" className="hidden-file-input" tabIndex={-1} onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      console.log(`[Inline Grid - Image Selected] Selected file for row #${entry.id}, column #${col.id}:`, f.name, `${(f.size / 1024).toFixed(1)} KB`);
                      setUploadingImageCols(prev => ({ ...prev, [col.id]: true }));
                      props.onImageUploadStart?.();
                      console.log(`[Inline Grid - Image Upload] Starting compression & upload...`);
                      ImageCompressionModule.compressAndUploadImage(f, entry.registerId || 0, entry.id, col.id.toString())
                        .then(c => {
                          console.log(`[Inline Grid - Image Upload] Upload / Compression succeeded. Persisting to database...`);
                          return handleCellChange(entry.id, col.id.toString(), c);
                        })
                        .then(() => {
                          console.log(`[Inline Grid - Image Upload] PERSISTED successfully to database for row #${entry.id}, column #${col.id}!`);
                        })
                        .catch(err => {
                          console.error(`[Inline Grid - Image Upload] FAILED for row #${entry.id}, column #${col.id}:`, err);
                        })
                        .finally(() => {
                          setUploadingImageCols(prev => ({ ...prev, [col.id]: false }));
                          props.onImageUploadEnd?.();
                        });
                      e.target.value = '';
                    }} />
                  </label>
                ) : (
                  <span className="cell-placeholder" style={{ fontSize: '10px', opacity: 0.5 }}>—</span>
                )
              )}
            </div>
          ) : col.type === 'signature' ? (
            <div 
              data-cell={`cell-${idx}-${col.id}`} 
              tabIndex={0} 
              className="cell-image-wrap" 
              onKeyDown={(e) => handleCellKeyDown(e, col.id, colIdx)}
              onClick={() => {
                if (isLockedByOther && cellLock) {
                  toast(`🔒 ${cellLock.userName} is currently editing this cell`, { id: `lock-${entry.id}-${col.id}`, duration: 1800 });
                  return;
                }
                if (canEditCell && props.onOpenSignaturePad) {
                  props.onOpenSignaturePad(entry.id, col.id, entry.cells?.[col.id.toString()] || '', col.name);
                }
              }}
              style={{ cursor: canEditCell ? 'pointer' : 'default', padding: '2px 6px', display: 'flex', alignItems: 'center', height: '100%' }}
              title={isLockedByOther ? `Locked by ${cellLock?.userName}` : (entry.cells?.[col.id.toString()] ? "Click to view or re-sign signature" : (canEditCell ? "Click to draw signature" : ""))}
            >
              {entry.cells?.[col.id.toString()] ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 8px', background: 'rgba(29, 78, 216, 0.05)', borderRadius: '6px', border: '1px solid rgba(29, 78, 216, 0.15)', maxWidth: '100%', overflow: 'hidden' }}>
                  <img 
                    src={entry.cells[col.id.toString()]} 
                    alt="Signature" 
                    style={{ height: '22px', maxWidth: '90px', objectFit: 'contain' }} 
                  />
                  <PenTool size={10} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                </div>
              ) : (
                canEditCell ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', padding: '4px 8px', borderRadius: '6px', background: 'rgba(29, 78, 216, 0.08)', border: '1px dashed rgba(29, 78, 216, 0.3)' }}>
                    <PenTool size={13} />
                  </span>
                ) : (
                  <span className="cell-placeholder" style={{ fontSize: '10px', opacity: 0.5 }}>—</span>
                )
              )}
            </div>
          ) : col.type === 'email' ? (
            <div className="cell-url-wrap">
              {typeof entry.cells?.[col.id.toString()] === 'string' && entry.cells[col.id.toString()].includes(' ||| ') ? (
                <SplitTextInput idx={idx} col={col} entry={entry} visibleColumns={visibleColumns} colIdx={colIdx} totalRows={totalRows} handleCellChange={handleCellChange} type="email" placeholder="name@example.com" readOnly={!canEditCell} scrollToColumn={scrollToColumn} />
              ) : (
                <SpreadsheetTextInput idx={idx} col={col} entry={entry} visibleColumns={visibleColumns} colIdx={colIdx} totalRows={totalRows} handleCellChange={handleCellChange} type="email" placeholder="name@example.com" searchTerm={searchTerm} readOnly={!isEditable} scrollToColumn={scrollToColumn} registerId={registerId} currentUserName={currentUserName} currentUserId={currentUserId} cellLock={cellLock} />
              )}
              {entry.cells?.[col.id.toString()] && <a href={`mailto:${entry.cells[col.id.toString()]}`} className="cell-url-link" title="Send email" tabIndex={-1}><Mail size={11} /></a>}
            </div>
          ) : col.type === 'phone' ? (
            <div className="cell-url-wrap">
              {typeof entry.cells?.[col.id.toString()] === 'string' && entry.cells[col.id.toString()].includes(' ||| ') ? (
                <SplitTextInput idx={idx} col={col} entry={entry} visibleColumns={visibleColumns} colIdx={colIdx} totalRows={totalRows} handleCellChange={handleCellChange} type="tel" placeholder="+91 98765 43210" readOnly={!canEditCell} scrollToColumn={scrollToColumn} />
              ) : (
                <SpreadsheetTextInput idx={idx} col={col} entry={entry} visibleColumns={visibleColumns} colIdx={colIdx} totalRows={totalRows} handleCellChange={handleCellChange} type="tel" placeholder="+91 98765 43210" searchTerm={searchTerm} readOnly={!isEditable} scrollToColumn={scrollToColumn} registerId={registerId} currentUserName={currentUserName} currentUserId={currentUserId} cellLock={cellLock} />
              )}
              {entry.cells?.[col.id.toString()] && <a href={`tel:${entry.cells[col.id.toString()]}`} className="cell-url-link" title="Call" tabIndex={-1}><Phone size={11} /></a>}
            </div>
          ) : col.type === 'url' ? (
            <div className="cell-url-wrap">
              {typeof entry.cells?.[col.id.toString()] === 'string' && entry.cells[col.id.toString()].includes(' ||| ') ? (
                <SplitTextInput idx={idx} col={col} entry={entry} visibleColumns={visibleColumns} colIdx={colIdx} totalRows={totalRows} handleCellChange={handleCellChange} type="url" placeholder="https://..." readOnly={!canEditCell} scrollToColumn={scrollToColumn} />
              ) : (
                <SpreadsheetTextInput idx={idx} col={col} entry={entry} visibleColumns={visibleColumns} colIdx={colIdx} totalRows={totalRows} handleCellChange={handleCellChange} type="url" placeholder="https://..." searchTerm={searchTerm} readOnly={!isEditable} scrollToColumn={scrollToColumn} registerId={registerId} currentUserName={currentUserName} currentUserId={currentUserId} cellLock={cellLock} />
              )}
              {entry.cells?.[col.id.toString()] && <a href={entry.cells[col.id.toString()]} target="_blank" rel="noreferrer" className="cell-url-link" title="Open" tabIndex={-1}><Globe size={11} /></a>}
            </div>
          ) : col.type === 'auto_increment' ? (
            <div 
              data-cell={`cell-${idx}-${col.id}`} 
              className="cell-auto-increment-cell-readonly" 
              tabIndex={0} 
              title="Auto-generated ID (Read-only)" 
              onKeyDown={(e) => handleCellKeyDown(e, col.id, colIdx)}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px', 
                padding: '0 8px', 
                color: '#64748b', 
                background: 'var(--table-bg)',
                height: '100%',
                fontSize: '12px',
                fontWeight: 500
              }}
            >
              <ListOrdered size={12} style={{ opacity: 0.6 }} />
              <span><HighlightedText text={(col.type === 'auto_increment' || String(col.id) === 'col_sno' || (col as any).key === 'col_sno') ? String(entry.rowNumber || (entry as any).row_number || (idx + 1)) : (entry.cells?.[col.id.toString()] || '–')} searchTerm={searchTerm} /></span>
            </div>
          ) : col.type === 'currency' ? (
            typeof entry.cells?.[col.id.toString()] === 'string' && entry.cells[col.id.toString()].includes(' ||| ') ? (
              <SplitCurrencyCell idx={idx} col={col} entry={entry} colIdx={colIdx} handleCellChange={handleCellChange} visibleColumns={visibleColumns} totalRows={totalRows} readOnly={!canEditCell} scrollToColumn={scrollToColumn} />
            ) : (
              <CurrencyCell idx={idx} col={col} entry={entry} colIdx={colIdx} handleCellChange={handleCellChange} visibleColumns={visibleColumns} totalRows={totalRows} readOnly={!isEditable} scrollToColumn={scrollToColumn} registerId={registerId} currentUserName={currentUserName} currentUserId={currentUserId} cellLock={cellLock} onKeyDown={(e) => handleCellKeyDown(e, col.id, colIdx)} />
            )
          ) : (
            typeof entry.cells?.[col.id.toString()] === 'string' && entry.cells[col.id.toString()].includes(' ||| ') ? (
              <SplitTextInput
                idx={idx}
                col={col}
                entry={entry}
                visibleColumns={visibleColumns}
                colIdx={colIdx}
                totalRows={totalRows}
                handleCellChange={handleCellChange}
                readOnly={!canEditCell}
                scrollToColumn={scrollToColumn}
              />
            ) : (
              <SpreadsheetTextInput 
                idx={idx}
                col={col}
                entry={entry}
                visibleColumns={visibleColumns}
                colIdx={colIdx}
                totalRows={totalRows}
                handleCellChange={handleCellChange}
                searchTerm={searchTerm}
                readOnly={!isEditable}
                suggestions={columnSuggestions?.[col.id.toString()]}
                scrollToColumn={scrollToColumn}
                registerId={registerId}
                currentUserName={currentUserName}
                currentUserId={currentUserId}
                cellLock={cellLock}
              />
            )
          )}
          </>
          )}
          {(!isCellHidden || isCellRevealed) && col.type !== 'formula' && col.type !== 'auto_increment' && canEditCell && (
            <div 
              className="fill-handle" 
              data-row-idx={idx} 
              data-col-id={col.id} 
              data-entry-id={entry.id} 
            />
          )}
          </div>
        </td>
        );
      })}
      <td className="actions" style={{ width: '50px', minWidth: '50px', position: 'sticky', right: 0, zIndex: 1, background: 'var(--table-bg)', borderLeft: '1px solid var(--border-v)' }} />
    </tr>
  );
});
