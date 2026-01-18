"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ParsedCriteria } from "@/lib/criteria/parseText";
import { SelectedLocation } from "@/lib/supabase/types";

interface QuickCreateModeProps {
  onApply: (
    parsed: Partial<{
      transaction_type: string;
      property_types: string[];
      bedrooms: string;
      min_price_aed: string;
      max_price_aed: string;
      min_area_sqft: string;
      max_area_sqft: string;
      furnishing: string[];
      is_off_plan: boolean | null;
      is_distressed_deal: boolean | null;
      is_urgent: boolean | null;
      is_direct: boolean | null;
      ai_prompt: string;
    }>,
    locations: SelectedLocation[]
  ) => void;
  onCancel: () => void;
}

interface ParseResult {
  parsed: ParsedCriteria;
  confidence: number;
  warnings: string[];
}

interface ResolvedLocation {
  inputName: string;
  resolved: SelectedLocation | null;
  status: "pending" | "resolved" | "not_found" | "multiple";
  options?: SelectedLocation[];
}

const PLACEHOLDER_TEXT = `Example: "Looking for a 2-3 bedroom apartment in Dubai Marina or JBR, budget around 2-3M AED, must be furnished with sea view, preferably high floor with balcony"

Or try:
- "Investor looking for off-plan villa in Palm Jumeirah under 10M"
- "Family needs 4BR+ in a good school district, max 150K/year rent"
- "Labor camp with 500+ person capacity in DIP or JAFZA"`;

export function QuickCreateMode({ onApply, onCancel }: QuickCreateModeProps) {
  const [text, setText] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedLocations, setResolvedLocations] = useState<ResolvedLocation[]>([]);
  const [isResolvingLocations, setIsResolvingLocations] = useState(false);

  // Resolve location names to PSL codes when parse result changes
  useEffect(() => {
    if (!parseResult?.parsed.location_names.length) {
      setResolvedLocations([]);
      return;
    }

    const resolveLocations = async () => {
      setIsResolvingLocations(true);
      const results: ResolvedLocation[] = [];

      for (const name of parseResult.parsed.location_names) {
        try {
          const response = await fetch(`/api/locations?q=${encodeURIComponent(name)}`);
          const data = await response.json();
          const locations = data.locations || [];

          if (locations.length === 0) {
            results.push({ inputName: name, resolved: null, status: "not_found" });
          } else if (locations.length === 1) {
            results.push({ inputName: name, resolved: locations[0], status: "resolved" });
          } else {
            // Multiple matches - auto-select first but show as multiple
            results.push({
              inputName: name,
              resolved: locations[0],
              status: "multiple",
              options: locations.slice(0, 5),
            });
          }
        } catch {
          results.push({ inputName: name, resolved: null, status: "not_found" });
        }
      }

      setResolvedLocations(results);
      setIsResolvingLocations(false);
    };

    resolveLocations();
  }, [parseResult?.parsed.location_names]);

  const handleParse = async () => {
    if (!text.trim()) return;

    setIsParsing(true);
    setError(null);
    setParseResult(null);

    try {
      const response = await fetch("/api/criteria/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to parse");
      }

      const result: ParseResult = await response.json();
      setParseResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse text");
    } finally {
      setIsParsing(false);
    }
  };

  const handleApply = () => {
    if (!parseResult) return;

    const { parsed } = parseResult;

    // Convert parsed criteria to form format
    const formData = {
      transaction_type: parsed.transaction_type,
      property_types: parsed.property_types,
      bedrooms: parsed.bedrooms.join(", "),
      min_price_aed: parsed.min_price_aed?.toString() || "",
      max_price_aed: parsed.max_price_aed?.toString() || "",
      min_area_sqft: parsed.min_area_sqft?.toString() || "",
      max_area_sqft: parsed.max_area_sqft?.toString() || "",
      furnishing: parsed.furnishing,
      is_off_plan: parsed.is_off_plan,
      is_distressed_deal: parsed.is_distressed_deal,
      is_urgent: parsed.is_urgent,
      is_direct: parsed.is_direct,
      ai_prompt: parsed.ai_prompt,
    };

    // Get resolved locations
    const locations = resolvedLocations
      .filter((r) => r.resolved)
      .map((r) => r.resolved as SelectedLocation);

    onApply(formData, locations);
  };

  const handleLocationSelect = (index: number, location: SelectedLocation) => {
    setResolvedLocations((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, resolved: location, status: "resolved" } : r
      )
    );
  };

  const formatPrice = (price: number | null) => {
    if (!price) return "—";
    if (price >= 1000000) {
      return `${(price / 1000000).toFixed(price % 1000000 === 0 ? 0 : 1)}M AED`;
    }
    return `${price.toLocaleString()} AED`;
  };

  return (
    <div className="border rounded-lg p-4 mb-6 bg-gradient-to-br from-purple-50 to-blue-50 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">✨</span>
          <h3 className="font-semibold text-lg text-purple-900">
            Quick Create with AI
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          ← Back to Manual Form
        </Button>
      </div>

      {/* Input Section */}
      <div className="space-y-2">
        <Label className="text-purple-800">
          Describe what your buyer is looking for
        </Label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER_TEXT}
          rows={6}
          className="bg-white resize-none"
          disabled={isParsing}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {text.length}/5000 characters
          </p>
          <Button
            onClick={handleParse}
            disabled={isParsing || !text.trim()}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {isParsing ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Parsing...
              </>
            ) : (
              <>
                <span className="mr-2">🔮</span>
                Parse with AI
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Parse Results */}
      {parseResult && (
        <Card className="border-purple-200">
          <CardContent className="pt-4 space-y-4">
            {/* Header with confidence */}
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-purple-900 flex items-center gap-2">
                <span>📋</span> Parsed Filters
              </h4>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    parseResult.confidence >= 80
                      ? "default"
                      : parseResult.confidence >= 50
                      ? "secondary"
                      : "destructive"
                  }
                  className={
                    parseResult.confidence >= 80
                      ? "bg-green-600"
                      : parseResult.confidence >= 50
                      ? "bg-yellow-600"
                      : ""
                  }
                >
                  {parseResult.confidence}% confidence
                </Badge>
              </div>
            </div>

            {/* Warnings */}
            {parseResult.warnings.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-sm text-yellow-800">
                <p className="font-medium mb-1">⚠️ Warnings:</p>
                <ul className="list-disc ml-4">
                  {parseResult.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Parsed Fields Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {/* Transaction Type */}
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-xs text-gray-500 mb-1">Transaction</p>
                <Badge variant="outline" className="capitalize">
                  {parseResult.parsed.transaction_type}
                </Badge>
              </div>

              {/* Property Types */}
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-xs text-gray-500 mb-1">Property Types</p>
                {parseResult.parsed.property_types.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {parseResult.parsed.property_types.map((t) => (
                      <Badge key={t} variant="secondary" className="capitalize text-xs">
                        {t}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-gray-400 text-sm">Any</span>
                )}
              </div>

              {/* Bedrooms */}
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-xs text-gray-500 mb-1">Bedrooms</p>
                {parseResult.parsed.bedrooms.length > 0 ? (
                  <span className="font-medium">
                    {parseResult.parsed.bedrooms.map((b) => (b === 0 ? "Studio" : `${b}BR`)).join(", ")}
                  </span>
                ) : (
                  <span className="text-gray-400 text-sm">Any</span>
                )}
              </div>

              {/* Price Range */}
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-xs text-gray-500 mb-1">Price Range</p>
                <span className="font-medium">
                  {formatPrice(parseResult.parsed.min_price_aed)} –{" "}
                  {formatPrice(parseResult.parsed.max_price_aed)}
                </span>
              </div>

              {/* Area Range */}
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-xs text-gray-500 mb-1">Area</p>
                {parseResult.parsed.min_area_sqft || parseResult.parsed.max_area_sqft ? (
                  <span className="font-medium">
                    {parseResult.parsed.min_area_sqft?.toLocaleString() || "—"} –{" "}
                    {parseResult.parsed.max_area_sqft?.toLocaleString() || "—"} sqft
                  </span>
                ) : (
                  <span className="text-gray-400 text-sm">Any</span>
                )}
              </div>

              {/* Furnishing */}
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-xs text-gray-500 mb-1">Furnishing</p>
                {parseResult.parsed.furnishing.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {parseResult.parsed.furnishing.map((f) => (
                      <Badge key={f} variant="outline" className="capitalize text-xs">
                        {f}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-gray-400 text-sm">Any</span>
                )}
              </div>
            </div>

            {/* Boolean Filters */}
            {(parseResult.parsed.is_off_plan !== null ||
              parseResult.parsed.is_distressed_deal !== null ||
              parseResult.parsed.is_urgent !== null ||
              parseResult.parsed.is_direct !== null) && (
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-xs text-gray-500 mb-2">Special Filters</p>
                <div className="flex flex-wrap gap-2">
                  {parseResult.parsed.is_off_plan === true && (
                    <Badge className="bg-purple-100 text-purple-800 border-purple-200">Off-Plan</Badge>
                  )}
                  {parseResult.parsed.is_distressed_deal === true && (
                    <Badge className="bg-red-100 text-red-800 border-red-200">Below Market</Badge>
                  )}
                  {parseResult.parsed.is_urgent === true && (
                    <Badge className="bg-orange-100 text-orange-800 border-orange-200">Urgent</Badge>
                  )}
                  {parseResult.parsed.is_direct === true && (
                    <Badge className="bg-green-100 text-green-800 border-green-200">Direct</Badge>
                  )}
                </div>
              </div>
            )}

            {/* Locations */}
            {parseResult.parsed.location_names.length > 0 && (
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-xs text-gray-500 mb-2">
                  Locations{" "}
                  {isResolvingLocations && (
                    <span className="animate-pulse">(resolving...)</span>
                  )}
                </p>
                <div className="space-y-2">
                  {resolvedLocations.map((loc, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="text-sm font-medium">{loc.inputName}</span>
                      <span className="text-gray-400">→</span>
                      {loc.status === "pending" && (
                        <span className="text-gray-400 text-sm animate-pulse">
                          Resolving...
                        </span>
                      )}
                      {loc.status === "resolved" && loc.resolved && (
                        <Badge variant="secondary" className="text-xs">
                          {loc.resolved.name}
                        </Badge>
                      )}
                      {loc.status === "multiple" && loc.options && (
                        <select
                          className="text-sm border rounded px-2 py-1"
                          value={loc.resolved?.pslCode || ""}
                          onChange={(e) => {
                            const selected = loc.options?.find(
                              (o) => o.pslCode === e.target.value
                            );
                            if (selected) handleLocationSelect(index, selected);
                          }}
                        >
                          {loc.options.map((opt) => (
                            <option key={opt.pslCode} value={opt.pslCode}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {loc.status === "not_found" && (
                        <Badge variant="destructive" className="text-xs">
                          Not found
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Prompt (unmapped requirements) */}
            {parseResult.parsed.ai_prompt && (
              <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                <p className="text-xs text-blue-700 font-medium mb-1">
                  🤖 AI Will Evaluate These Requirements
                </p>
                <p className="text-sm text-blue-900">{parseResult.parsed.ai_prompt}</p>
                <p className="text-xs text-blue-600 mt-2">
                  These requirements cannot be filtered in Typesense and will be evaluated by Gemini AI for each result.
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2 border-t">
              <Button
                onClick={handleApply}
                className="bg-purple-600 hover:bg-purple-700"
                disabled={isResolvingLocations}
              >
                ✓ Apply to Form
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setParseResult(null);
                  setResolvedLocations([]);
                }}
              >
                Parse Again
              </Button>
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
