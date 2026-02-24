import { useCallback, useRef, useState } from "react";

interface FileLoaderProps {
  onFilesSelected: (files: File[]) => void;
}

export function FileLoader({ onFilesSelected }: FileLoaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.name.endsWith(".json")
      );
      if (files.length > 0) onFilesSelected(files);
    },
    [onFilesSelected]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) onFilesSelected(files);
      // Reset so same file can be re-selected
      e.target.value = "";
    },
    [onFilesSelected]
  );

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
        isDragOver
          ? "border-blue-400 bg-blue-50"
          : "border-gray-300 hover:border-gray-400 bg-gray-50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />
      <div className="text-gray-500">
        <div className="text-3xl mb-2">📂</div>
        <p className="font-medium">Drop result JSON files here</p>
        <p className="text-sm mt-1">or click to browse</p>
      </div>
    </div>
  );
}
