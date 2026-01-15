"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface KeywordChipsInputProps {
  keywords: string[];
  onKeywordsChange: (keywords: string[]) => void;
  placeholder?: string;
  id?: string;
}

/**
 * Keyword input with chip/badge display.
 * Press Enter or comma to add a keyword as a chip.
 * Click a chip to remove it.
 * Backspace on empty input removes the last keyword.
 */
export function KeywordChipsInput({
  keywords,
  onKeywordsChange,
  placeholder = "Type and press Enter to add...",
  id,
}: KeywordChipsInputProps) {
  const [inputValue, setInputValue] = useState("");

  const addKeyword = (keyword: string) => {
    const trimmed = keyword.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      onKeywordsChange([...keywords, trimmed]);
    }
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword(inputValue);
    } else if (e.key === "," && inputValue.trim()) {
      e.preventDefault();
      addKeyword(inputValue);
    } else if (e.key === "Backspace" && !inputValue && keywords.length > 0) {
      // Remove last keyword on backspace in empty input
      onKeywordsChange(keywords.slice(0, -1));
    }
  };

  const handleRemove = (keywordToRemove: string) => {
    onKeywordsChange(keywords.filter((k) => k !== keywordToRemove));
  };

  return (
    <div className="space-y-2">
      {/* Keyword chips */}
      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {keywords.map((keyword) => (
            <Badge
              key={keyword}
              variant="secondary"
              className="cursor-pointer hover:bg-red-100 hover:text-red-700"
              onClick={() => handleRemove(keyword)}
              title="Click to remove"
            >
              {keyword} ✕
            </Badge>
          ))}
        </div>
      )}

      {/* Input */}
      <Input
        id={id}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      <p className="text-xs text-gray-500">
        Press Enter to add keywords. Click a keyword to remove it.
      </p>
    </div>
  );
}
