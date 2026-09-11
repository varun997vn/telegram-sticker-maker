import { useCallback, useEffect, useRef, useState } from 'react';
import { IMAGE_ACCEPT, isSupportedImageType } from '../core/imageSource.ts';

interface DropZoneProps {
  readonly onFile: (file: File) => void;
  readonly disabled?: boolean;
}

/** Accepts a file by drop, by picker, or by paste from the clipboard. */
export function DropZone({ onFile, disabled = false }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  useEffect(() => {
    if (disabled) return;

    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.files;
      const file = items?.[0];
      if (file && isSupportedImageType(file.type, file.name)) {
        event.preventDefault();
        onFile(file);
      }
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFile, disabled]);

  return (
    <div
      className={`dropzone${isDragging ? ' dropzone--active' : ''}`}
      data-testid="dropzone"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        className="dropzone__input"
        data-testid="file-input"
        type="file"
        accept={IMAGE_ACCEPT}
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files);
          // Reset so re-picking the same file fires a change event again.
          event.target.value = '';
        }}
      />
      <button
        type="button"
        className="dropzone__button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Choose an image
      </button>
      <p className="dropzone__hint">or drop one here, or paste from the clipboard</p>
    </div>
  );
}
