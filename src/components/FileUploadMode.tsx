"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NamedParsedCriteria } from "@/lib/criteria/parseText";

interface FileUploadModeProps {
  onCreateCriteria: (criteria: NamedParsedCriteria[]) => Promise<void>;
  onCancel: () => void;
}

interface ParsedCriteriaItem {
  parsed: NamedParsedCriteria;
  confidence: number;
  selected: boolean;
}

interface ParseFileResult {
  criteria: Array<{
    parsed: NamedParsedCriteria;
    confidence: number;
  }>;
  warnings: string[];
}

const ACCEPTED_FILE_TYPES = ".pdf,.png,.jpg,.jpeg,.webp";

export function FileUploadMode({ onCreateCriteria, onCancel }: FileUploadModeProps) {
  const [file, setFile] = useState<File | null>(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [parsedCriteria, setParsedCriteria] = useState<ParsedCriteriaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setParsedCriteria([]);
    setWarnings([]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleParse = async () => {
    if (!file) return;

    setIsParsing(true);
    setError(null);
    setParsedCriteria([]);
    setWarnings([]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (additionalContext.trim()) {
        formData.append("context", additionalContext.trim());
      }

      const response = await fetch("/api/criteria/parse-file", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to parse file");
      }

      const result: ParseFileResult = await response.json();

      if (result.warnings.length > 0) {
        setWarnings(result.warnings);
      }

      if (result.criteria.length === 0) {
        setError("No buyer requirements could be extracted from the file.");
        return;
      }

      // Initialize all criteria as selected
      setParsedCriteria(
        result.criteria.map((c) => ({
          ...c,
          selected: true,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setIsParsing(false);
    }
  };

  const handleToggleCriteria = (index: number) => {
    setParsedCriteria((prev) =>
      prev.map((c, i) => (i === index ? { ...c, selected: !c.selected } : c))
    );
  };

  const handleCreateSelected = async () => {
    const selected = parsedCriteria.filter((c) => c.selected);
    if (selected.length === 0) {
      setError("Please select at least one criteria to create");
      return;
    }

    setIsCreating(true);
    try {
      await onCreateCriteria(selected.map((c) => c.parsed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create criteria");
    } finally {
      setIsCreating(false);
    }
  };

  const selectedCount = parsedCriteria.filter((c) => c.selected).length;

  const formatPrice = (price: number | null) => {
    if (!price) return "—";
    if (price >= 1000000) {
      return `${(price / 1000000).toFixed(price % 1000000 === 0 ? 0 : 1)}M AED`;
    }
    return `${price.toLocaleString()} AED`;
  };

  return (
    <div className="border rounded-lg p-4 mb-6 bg-gradient-to-br from-blue-50 to-indigo-50 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📄</span>
          <h3 className="font-semibold text-lg text-blue-900">
            Import from File
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          ← Back
        </Button>
      </div>

      {/* File Upload Area */}
      {!parsedCriteria.length && (
        <>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300 hover:border-blue-400"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
              className="hidden"
            />

            {file ? (
              <div className="space-y-2">
                <div className="text-4xl">
                  {file.type === "application/pdf" ? "📑" : "🖼️"}
                </div>
                <p className="font-medium text-gray-900">{file.name}</p>
                <p className="text-sm text-gray-500">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Change File
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-4xl">📤</div>
                <p className="text-gray-600">
                  Drag & drop a PDF or image, or{" "}
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    browse
                  </button>
                </p>
                <p className="text-xs text-gray-400">
                  Supports PDF, PNG, JPEG, WebP (max 10MB)
                </p>
              </div>
            )}
          </div>

          {/* Additional Context */}
          <div className="space-y-2">
            <Label className="text-blue-800">
              Additional Context (optional)
            </Label>
            <Textarea
              value={additionalContext}
              onChange={(e) => setAdditionalContext(e.target.value)}
              placeholder="Add any context to help interpret the document, e.g., 'This is a WhatsApp conversation about labor camps' or 'Focus on the urgent requirements only'"
              rows={3}
              className="bg-white resize-none"
            />
          </div>

          {/* Parse Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleParse}
              disabled={!file || isParsing}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isParsing ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Analyzing File...
                </>
              ) : (
                <>
                  <span className="mr-2">🔍</span>
                  Extract Requirements
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          <p className="font-medium mb-1">⚠️ Warnings:</p>
          <ul className="list-disc ml-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Parsed Criteria Results */}
      {parsedCriteria.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-blue-900">
              Found {parsedCriteria.length} Search{" "}
              {parsedCriteria.length === 1 ? "Criteria" : "Criteria"}
            </h4>
            <Badge variant="secondary">
              {selectedCount} selected
            </Badge>
          </div>

          {/* Criteria Cards */}
          <div className="space-y-3">
            {parsedCriteria.map((item, index) => (
              <Card
                key={index}
                className={`border-2 transition-colors ${
                  item.selected
                    ? "border-blue-300 bg-white"
                    : "border-gray-200 bg-gray-50 opacity-60"
                }`}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={item.selected}
                        onCheckedChange={() => handleToggleCriteria(index)}
                      />
                      <div>
                        <h5 className="font-semibold text-gray-900">
                          {item.parsed.name}
                        </h5>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs capitalize">
                            {item.parsed.transaction_type}
                          </Badge>
                          <Badge
                            variant={
                              item.confidence >= 80
                                ? "default"
                                : item.confidence >= 50
                                ? "secondary"
                                : "destructive"
                            }
                            className={`text-xs ${
                              item.confidence >= 80
                                ? "bg-green-600"
                                : item.confidence >= 50
                                ? "bg-yellow-600"
                                : ""
                            }`}
                          >
                            {item.confidence}% confidence
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Criteria Details Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    {item.parsed.property_types.length > 0 && (
                      <div>
                        <span className="text-gray-500">Type:</span>{" "}
                        <span className="capitalize">
                          {item.parsed.property_types.join(", ")}
                        </span>
                      </div>
                    )}
                    {item.parsed.bedrooms.length > 0 && (
                      <div>
                        <span className="text-gray-500">Beds:</span>{" "}
                        {item.parsed.bedrooms
                          .map((b) => (b === 0 ? "Studio" : `${b}BR`))
                          .join(", ")}
                      </div>
                    )}
                    {(item.parsed.min_price_aed || item.parsed.max_price_aed) && (
                      <div>
                        <span className="text-gray-500">Price:</span>{" "}
                        {formatPrice(item.parsed.min_price_aed)} –{" "}
                        {formatPrice(item.parsed.max_price_aed)}
                      </div>
                    )}
                    {item.parsed.location_names.length > 0 && (
                      <div>
                        <span className="text-gray-500">Location:</span>{" "}
                        {item.parsed.location_names.slice(0, 2).join(", ")}
                        {item.parsed.location_names.length > 2 && (
                          <span className="text-gray-400">
                            {" "}
                            +{item.parsed.location_names.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* AI Prompt */}
                  {item.parsed.ai_prompt && (
                    <div className="mt-2 p-2 bg-blue-50 rounded text-sm text-blue-800">
                      <span className="font-medium">AI Qualifier:</span>{" "}
                      {item.parsed.ai_prompt}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2 border-t">
            <Button
              onClick={handleCreateSelected}
              disabled={selectedCount === 0 || isCreating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isCreating ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Creating...
                </>
              ) : (
                <>
                  ✓ Create {selectedCount} Search{" "}
                  {selectedCount === 1 ? "Criteria" : "Criteria"}
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setParsedCriteria([]);
                setFile(null);
                setWarnings([]);
              }}
            >
              Upload Different File
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
