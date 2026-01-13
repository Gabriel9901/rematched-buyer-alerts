"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { Buyer, BuyerCriteria, Match } from "@/lib/supabase/types";
import { LocationSearch } from "@/components/LocationSearch";

interface SelectedLocation {
  name: string;
  pslCode: string;
  address: string;
}

// Default qualification prompt template
const DEFAULT_QUALIFICATION_PROMPT = `You are a real estate matching assistant. Analyze how well this property listing matches the buyer's requirements.

BUYER REQUIREMENTS:
{requirements}

PROPERTY LISTING:
{listing}

Evaluate the match and respond with ONLY a JSON object in this exact format:
{
  "score": <number 0-100>,
  "explanation": "<brief 1-2 sentence summary>",
  "highlights": ["<matching point 1>", "<matching point 2>"],
  "concerns": ["<potential issue 1>", "<potential issue 2>"]
}

Scoring guide:
- 90-100: Perfect match on all criteria
- 70-89: Good match, minor deviations
- 50-69: Partial match, some criteria not met
- 30-49: Weak match, significant mismatches
- 0-29: Poor match, most criteria not met

Be strict but fair. Only include real highlights and concerns.`;

const PROPERTY_TYPES = [
  "apartment",
  "villa",
  "townhouse",
  "office",
  "land",
  "retail",
  "other",
];

// Location search now handles communities via PSL codes

interface CriteriaWithMatches extends BuyerCriteria {
  matches?: { count: number }[];
}

export default function BuyerDetailPage() {
  const params = useParams();
  const buyerId = params.id as string;

  const [buyer, setBuyer] = useState<Buyer | null>(null);
  const [criteria, setCriteria] = useState<CriteriaWithMatches[]>([]);
  const [recentMatches, setRecentMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    totalMatches: number;
    duration: number;
  } | null>(null);
  const [searchProgress, setSearchProgress] = useState<{
    step: string;
    criteriaName?: string;
    message: string;
    current?: number;
    total?: number;
    details?: string;
  } | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [debugEvents, setDebugEvents] = useState<Array<{
    step: string;
    timestamp: number;
    data: Record<string, unknown>;
  }>>([]);
  const [expandedDebugPanels, setExpandedDebugPanels] = useState<Set<number>>(new Set());
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [qualificationPrompt, setQualificationPrompt] = useState<string>("");

  // AbortController ref for cancelling in-flight searches
  const abortControllerRef = useRef<AbortController | null>(null);

  const [showCriteriaForm, setShowCriteriaForm] = useState(false);
  const [editingCriteriaId, setEditingCriteriaId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState<SelectedLocation[]>([]);
  const [criteriaForm, setCriteriaForm] = useState({
    name: "",
    transaction_type: "sale",
    property_types: [] as string[],
    communities: [] as string[],
    bedrooms: "",
    min_price_aed: "",
    max_price_aed: "",
    min_area_sqft: "",
    max_area_sqft: "",
    keywords: "",
    ai_prompt: "",
    // Boolean filters
    is_off_plan: null as boolean | null,
    is_distressed_deal: null as boolean | null,
    is_urgent: null as boolean | null,
    is_direct: null as boolean | null,
    has_maid_bedroom: null as boolean | null,
    is_agent_covered: null as boolean | null,
    is_commission_split: null as boolean | null,
    is_mortgage_approved: null as boolean | null,
    is_community_agnostic: null as boolean | null,
    // String filters
    furnishing: [] as string[],
    mortgage_or_cash: [] as string[],
  });

  // Load qualification prompt from localStorage
  useEffect(() => {
    const savedPrompt = localStorage.getItem("qualification_prompt");
    setQualificationPrompt(savedPrompt || DEFAULT_QUALIFICATION_PROMPT);
  }, []);

  // Validate prompt has required placeholders
  const promptHasRequiredPlaceholders = (prompt: string) => {
    return prompt.includes("{requirements}") && prompt.includes("{listing}");
  };

  // Save prompt to localStorage
  const handleSavePrompt = () => {
    if (!promptHasRequiredPlaceholders(qualificationPrompt)) {
      alert("The prompt must contain both {requirements} and {listing} placeholders!");
      return;
    }
    localStorage.setItem("qualification_prompt", qualificationPrompt);
    setShowPromptEditor(false);
  };

  // Reset prompt to default
  const handleResetPrompt = () => {
    setQualificationPrompt(DEFAULT_QUALIFICATION_PROMPT);
  };

  const fetchBuyerData = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    try {
      // Fetch buyer
      const { data: buyerData, error: buyerError } = await supabase
        .from("buyers")
        .select("*")
        .eq("id", buyerId)
        .single();

      if (buyerError) throw buyerError;
      setBuyer(buyerData);

      // Fetch criteria with match counts
      const { data: criteriaData, error: criteriaError } = await supabase
        .from("buyer_criteria")
        .select(`
          *,
          matches(count)
        `)
        .eq("buyer_id", buyerId)
        .order("created_at", { ascending: false });

      if (criteriaError) throw criteriaError;
      setCriteria(criteriaData || []);

      // Fetch recent matches for this buyer's criteria
      const criteriaIds = (criteriaData || []).map((c) => c.id);
      if (criteriaIds.length > 0) {
        const { data: matchData, error: matchError } = await supabase
          .from("matches")
          .select(`
            *,
            criteria:buyer_criteria(name)
          `)
          .in("criteria_id", criteriaIds)
          .order("created_at", { ascending: false })
          .limit(10);

        if (matchError) throw matchError;
        setRecentMatches(matchData || []);
      }
    } catch (error) {
      console.error("Error fetching buyer data:", error);
    } finally {
      setLoading(false);
    }
  }, [buyerId]);

  useEffect(() => {
    fetchBuyerData();
  }, [fetchBuyerData]);

  const handleSaveCriteria = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured()) {
      alert("Supabase not configured");
      return;
    }

    setIsSaving(true);
    try {
      const criteriaData = {
        buyer_id: buyerId,
        name: criteriaForm.name,
        kind: "listing",
        transaction_type: criteriaForm.transaction_type,
        property_types:
          criteriaForm.property_types.length > 0
            ? criteriaForm.property_types
            : null,
        communities:
          criteriaForm.communities.length > 0
            ? criteriaForm.communities
            : null,
        // PSL codes from location search
        psl_codes:
          selectedLocations.length > 0
            ? selectedLocations.map((loc) => loc.pslCode)
            : null,
        bedrooms: criteriaForm.bedrooms
          ? criteriaForm.bedrooms.split(",").map((b) => parseInt(b.trim()))
          : null,
        min_price_aed: criteriaForm.min_price_aed
          ? parseInt(criteriaForm.min_price_aed)
          : null,
        max_price_aed: criteriaForm.max_price_aed
          ? parseInt(criteriaForm.max_price_aed)
          : null,
        // Area range
        min_area_sqft: criteriaForm.min_area_sqft
          ? parseInt(criteriaForm.min_area_sqft)
          : null,
        max_area_sqft: criteriaForm.max_area_sqft
          ? parseInt(criteriaForm.max_area_sqft)
          : null,
        keywords: criteriaForm.keywords || null,
        // AI prompt for Gemini qualification
        ai_prompt: criteriaForm.ai_prompt || null,
        // Boolean filters
        is_off_plan: criteriaForm.is_off_plan,
        is_distressed_deal: criteriaForm.is_distressed_deal,
        is_urgent: criteriaForm.is_urgent,
        is_direct: criteriaForm.is_direct,
        has_maid_bedroom: criteriaForm.has_maid_bedroom,
        is_agent_covered: criteriaForm.is_agent_covered,
        is_commission_split: criteriaForm.is_commission_split,
        is_mortgage_approved: criteriaForm.is_mortgage_approved,
        is_community_agnostic: criteriaForm.is_community_agnostic,
        // String filters
        furnishing:
          criteriaForm.furnishing.length > 0
            ? criteriaForm.furnishing
            : null,
        mortgage_or_cash:
          criteriaForm.mortgage_or_cash.length > 0
            ? criteriaForm.mortgage_or_cash
            : null,
        is_active: true,
      };

      let error;
      if (editingCriteriaId) {
        // Update existing criteria
        const result = await supabase
          .from("buyer_criteria")
          .update(criteriaData)
          .eq("id", editingCriteriaId);
        error = result.error;
      } else {
        // Insert new criteria
        const result = await supabase.from("buyer_criteria").insert(criteriaData);
        error = result.error;
      }

      if (error) throw error;

      // Reset form and refresh
      resetForm();
      setShowCriteriaForm(false);
      fetchBuyerData();
    } catch (error) {
      console.error("Error saving criteria:", error);
      alert("Failed to save criteria");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunSearch = async () => {
    // Cancel any existing search
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this search
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsSearching(true);
    setSearchResults(null);
    setSearchProgress({ step: 'init', message: 'Starting search...' });
    setDebugEvents([]);
    setExpandedDebugPanels(new Set());

    try {
      const response = await fetch("/api/search/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerId,
          debugMode,
          qualificationPrompt: qualificationPrompt !== DEFAULT_QUALIFICATION_PROMPT ? qualificationPrompt : undefined,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error("Search failed to start");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response stream");
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));

              // Capture debug events
              if (event.step.startsWith('debug_')) {
                setDebugEvents(prev => [...prev, {
                  step: event.step,
                  timestamp: Date.now(),
                  data: event,
                }]);
              }

              switch (event.step) {
                case 'searching':
                  setSearchProgress({
                    step: 'searching',
                    criteriaName: event.criteriaName,
                    message: `Searching Typesense for "${event.criteriaName}"...`,
                  });
                  break;
                case 'found':
                  setSearchProgress({
                    step: 'found',
                    criteriaName: event.criteriaName,
                    message: `Found ${event.count} listings (${event.total} total matches)`,
                    details: event.count === 0 ? 'No listings to qualify' : `Preparing to qualify with AI...`,
                  });
                  // Also capture found event with listings in debug mode
                  if (event.listings) {
                    setDebugEvents(prev => [...prev, {
                      step: 'found_listings',
                      timestamp: Date.now(),
                      data: event,
                    }]);
                  }
                  break;
                case 'qualifying_batch':
                  setSearchProgress({
                    step: 'qualifying',
                    criteriaName: event.criteriaName,
                    message: `Qualifying listings with AI (batch ${event.batchNumber}/${event.totalBatches})...`,
                    current: event.batchEnd,
                    total: event.total,
                    details: `Processing batch ${event.batchNumber} of ${event.totalBatches} (${event.batchStart}-${event.batchEnd} of ${event.total})`,
                  });
                  break;
                case 'qualifying':
                  setSearchProgress({
                    step: 'qualifying',
                    criteriaName: event.criteriaName,
                    message: `Qualifying listings with AI...`,
                    current: event.current,
                    total: event.total,
                    details: `Processing listing ${event.current}/${event.total}`,
                  });
                  break;
                case 'qualified':
                  setSearchProgress({
                    step: 'qualified',
                    criteriaName: event.criteriaName,
                    message: `Qualifying listings with AI...`,
                    current: event.current,
                    total: event.total,
                    details: `${event.current}/${event.total} - Score: ${event.score}% ${event.isMatch ? '✓' : '✗'}`,
                  });
                  break;
                case 'saving':
                  setSearchProgress({
                    step: 'saving',
                    criteriaName: event.criteriaName,
                    message: `Saving ${event.matchCount} qualified matches...`,
                  });
                  break;
                case 'saved':
                  setSearchProgress({
                    step: 'saved',
                    criteriaName: event.criteriaName,
                    message: `Saved ${event.savedCount} matches to database`,
                  });
                  break;
                case 'complete':
                  setSearchResults({
                    totalMatches: event.results.totalMatches,
                    duration: event.results.duration,
                  });
                  setSearchProgress(null);
                  fetchBuyerData();
                  break;
                case 'error':
                  throw new Error(event.message);
              }
            } catch (parseError) {
              // Only log parse errors, not abort errors propagated here
              if (!(parseError instanceof Error && parseError.name === 'AbortError')) {
                console.error('Failed to parse SSE event:', parseError);
              }
            }
          }
        }
      }
    } catch (error) {
      // Handle abort gracefully - user cancelled or navigated away
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Search cancelled');
        setSearchProgress({ step: 'cancelled', message: 'Search cancelled' });
        // Clear the cancelled message after a short delay
        setTimeout(() => setSearchProgress(null), 1500);
        return;
      }

      console.error("Search error:", error);
      alert("Search failed: " + (error instanceof Error ? error.message : "Unknown error"));
      setSearchProgress(null);
    } finally {
      setIsSearching(false);
      // Clear the controller ref if this is the current one
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  };

  // Cancel search handler
  const handleCancelSearch = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // Cleanup on unmount - cancel any in-flight search
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const togglePropertyType = (type: string) => {
    setCriteriaForm((prev) => ({
      ...prev,
      property_types: prev.property_types.includes(type)
        ? prev.property_types.filter((t) => t !== type)
        : [...prev.property_types, type],
    }));
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-AE", {
      style: "currency",
      currency: "AED",
      maximumFractionDigits: 0,
    }).format(price);
  };

  const resetForm = () => {
    setCriteriaForm({
      name: "",
      transaction_type: "sale",
      property_types: [],
      communities: [],
      bedrooms: "",
      min_price_aed: "",
      max_price_aed: "",
      min_area_sqft: "",
      max_area_sqft: "",
      keywords: "",
      ai_prompt: "",
      is_off_plan: null,
      is_distressed_deal: null,
      is_urgent: null,
      is_direct: null,
      has_maid_bedroom: null,
      is_agent_covered: null,
      is_commission_split: null,
      is_mortgage_approved: null,
      is_community_agnostic: null,
      furnishing: [],
      mortgage_or_cash: [],
    });
    setSelectedLocations([]);
    setEditingCriteriaId(null);
  };

  const handleEditCriteria = (criteriaToEdit: CriteriaWithMatches) => {
    // Populate form with existing criteria data
    setCriteriaForm({
      name: criteriaToEdit.name,
      transaction_type: criteriaToEdit.transaction_type,
      property_types: criteriaToEdit.property_types || [],
      communities: criteriaToEdit.communities || [],
      bedrooms: criteriaToEdit.bedrooms?.join(", ") || "",
      min_price_aed: criteriaToEdit.min_price_aed?.toString() || "",
      max_price_aed: criteriaToEdit.max_price_aed?.toString() || "",
      min_area_sqft: criteriaToEdit.min_area_sqft?.toString() || "",
      max_area_sqft: criteriaToEdit.max_area_sqft?.toString() || "",
      keywords: criteriaToEdit.keywords || "",
      ai_prompt: criteriaToEdit.ai_prompt || "",
      is_off_plan: criteriaToEdit.is_off_plan ?? null,
      is_distressed_deal: criteriaToEdit.is_distressed_deal ?? null,
      is_urgent: criteriaToEdit.is_urgent ?? null,
      is_direct: criteriaToEdit.is_direct ?? null,
      has_maid_bedroom: criteriaToEdit.has_maid_bedroom ?? null,
      is_agent_covered: criteriaToEdit.is_agent_covered ?? null,
      is_commission_split: criteriaToEdit.is_commission_split ?? null,
      is_mortgage_approved: criteriaToEdit.is_mortgage_approved ?? null,
      is_community_agnostic: criteriaToEdit.is_community_agnostic ?? null,
      furnishing: criteriaToEdit.furnishing || [],
      mortgage_or_cash: criteriaToEdit.mortgage_or_cash || [],
    });

    // Populate selected locations from PSL codes
    // Note: We only have PSL codes, not full location data, so we create minimal objects
    if (criteriaToEdit.psl_codes && criteriaToEdit.psl_codes.length > 0) {
      setSelectedLocations(
        criteriaToEdit.psl_codes.map((code) => ({
          name: code, // Will show PSL code as name since we don't have the actual name
          pslCode: code,
          address: code,
        }))
      );
    } else {
      setSelectedLocations([]);
    }

    setEditingCriteriaId(criteriaToEdit.id);
    setShowCriteriaForm(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse text-gray-500">Loading buyer...</div>
      </div>
    );
  }

  if (!buyer) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-700">Buyer not found</h2>
        <Link href="/buyers" className="text-blue-600 hover:underline mt-2 inline-block">
          Back to Buyers
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/buyers"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to Buyers
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-2">{buyer.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            {buyer.slack_channel && (
              <Badge variant="secondary">{buyer.slack_channel}</Badge>
            )}
            <span className="text-gray-500 text-sm">
              Added {new Date(buyer.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="debug-mode"
              checked={debugMode}
              onCheckedChange={setDebugMode}
            />
            <Label htmlFor="debug-mode" className="text-sm text-gray-600 cursor-pointer">
              Debug Mode
            </Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPromptEditor(!showPromptEditor)}
          >
            ⚙️ {showPromptEditor ? "Hide" : "Edit"} AI Prompt
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={handleRunSearch}
              disabled={isSearching || criteria.filter((c) => c.is_active).length === 0}
              className={debugMode ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700"}
            >
              {isSearching ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Searching...
                </>
              ) : debugMode ? (
                "🔧 Run Search (Debug)"
              ) : (
                "🔍 Run Search Now"
              )}
            </Button>
            {isSearching && (
              <Button
                variant="destructive"
                onClick={handleCancelSearch}
              >
                Cancel
              </Button>
            )}
            <Button variant="outline">Edit Buyer</Button>
          </div>
        </div>
      </div>

      {/* AI Prompt Editor */}
      {showPromptEditor && (
        <Card className="border-purple-200 bg-purple-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-purple-900 flex items-center justify-between">
              <span>⚙️ Qualification Prompt Template</span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetPrompt}
                  className="text-purple-700 hover:text-purple-900"
                >
                  Reset to Default
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-yellow-100 border border-yellow-300 rounded-lg p-3 text-sm">
              <p className="font-medium text-yellow-800 mb-2">⚠️ Required Placeholders</p>
              <p className="text-yellow-700">
                Your prompt <strong>must</strong> include these placeholders:
              </p>
              <ul className="list-disc ml-5 mt-1 text-yellow-700">
                <li><code className="bg-yellow-200 px-1 rounded">{"{requirements}"}</code> - Will be replaced with buyer requirements</li>
                <li><code className="bg-yellow-200 px-1 rounded">{"{listing}"}</code> - Will be replaced with listing details</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Prompt Template</Label>
                <div className="flex gap-2">
                  {!promptHasRequiredPlaceholders(qualificationPrompt) && (
                    <Badge variant="destructive">Missing placeholders!</Badge>
                  )}
                  {qualificationPrompt !== DEFAULT_QUALIFICATION_PROMPT && (
                    <Badge variant="secondary">Modified</Badge>
                  )}
                </div>
              </div>
              <Textarea
                value={qualificationPrompt}
                onChange={(e) => setQualificationPrompt(e.target.value)}
                rows={16}
                className="font-mono text-sm bg-white"
                placeholder="Enter your qualification prompt..."
              />
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleSavePrompt}
                disabled={!promptHasRequiredPlaceholders(qualificationPrompt)}
                className="bg-purple-600 hover:bg-purple-700"
              >
                Save Prompt
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowPromptEditor(false)}
              >
                Cancel
              </Button>
            </div>

            <div className="text-xs text-gray-500">
              <p className="font-medium mb-1">Tips:</p>
              <ul className="list-disc ml-4 space-y-1">
                <li>The response must be valid JSON with score, explanation, highlights, and concerns</li>
                <li>Adjust the scoring guide to match your specific criteria</li>
                <li>Add custom instructions for how to evaluate specific property types</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search Progress */}
      {searchProgress && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-blue-900">{searchProgress.message}</span>
                {searchProgress.criteriaName && (
                  <Badge variant="outline" className="text-blue-700 border-blue-300">
                    {searchProgress.criteriaName}
                  </Badge>
                )}
              </div>
              {searchProgress.details && (
                <p className="text-sm text-blue-700 mt-1">{searchProgress.details}</p>
              )}
              {searchProgress.current !== undefined && searchProgress.total !== undefined && (
                <div className="mt-2">
                  <div className="h-2 bg-blue-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${(searchProgress.current / searchProgress.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-blue-600 mt-1">
                    {searchProgress.current} of {searchProgress.total} listings processed
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Search Results Toast */}
      {searchResults && !searchProgress && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <span className="text-green-700 font-medium">
              ✅ Search completed! Found {searchResults.totalMatches} matches
            </span>
            <span className="text-green-600 text-sm ml-2">
              ({(searchResults.duration / 1000).toFixed(1)}s)
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSearchResults(null)}
          >
            ✕
          </Button>
        </div>
      )}

      {/* Debug Panel */}
      {debugEvents.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-orange-900 flex items-center gap-2">
                🔧 Debug Log ({debugEvents.length} events)
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDebugEvents([])}
                className="text-orange-700 hover:text-orange-900"
              >
                Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 max-h-[600px] overflow-y-auto">
            {debugEvents.map((event, index) => {
              const isExpanded = expandedDebugPanels.has(index);
              const toggleExpand = () => {
                setExpandedDebugPanels(prev => {
                  const next = new Set(prev);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                });
              };

              let bgColor = "bg-white";
              let borderColor = "border-gray-200";
              let icon = "📋";
              let title = event.step;

              if (event.step === 'debug_typesense_query') {
                icon = "🔍"; title = "Typesense Query";
                bgColor = "bg-blue-50"; borderColor = "border-blue-200";
              } else if (event.step === 'found_listings') {
                icon = "📦"; title = `Found ${(event.data as { count?: number }).count || 0} Listings`;
                bgColor = "bg-green-50"; borderColor = "border-green-200";
              } else if (event.step === 'debug_gemini_request') {
                icon = "📤"; title = `Gemini Request #${(event.data as { listingIndex?: number }).listingIndex}`;
                bgColor = "bg-purple-50"; borderColor = "border-purple-200";
              } else if (event.step === 'debug_gemini_response') {
                const score = ((event.data as { parsedResult?: { score?: number } }).parsedResult?.score) || 0;
                icon = "📥"; title = `Gemini Response #${(event.data as { listingIndex?: number }).listingIndex} (${score}%)`;
                bgColor = score >= 60 ? "bg-green-50" : "bg-red-50";
                borderColor = score >= 60 ? "border-green-200" : "border-red-200";
              } else if (event.step === 'debug_gemini_error') {
                icon = "❌"; title = `Gemini Error #${(event.data as { listingIndex?: number }).listingIndex}`;
                bgColor = "bg-red-50"; borderColor = "border-red-200";
              } else if (event.step === 'debug_qualification_summary') {
                icon = "📊"; title = "Qualification Summary";
                bgColor = "bg-yellow-50"; borderColor = "border-yellow-200";
              }

              return (
                <div key={index} className={`${bgColor} border ${borderColor} rounded-lg overflow-hidden`}>
                  <button
                    onClick={toggleExpand}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-black/5"
                  >
                    <div className="flex items-center gap-2">
                      <span>{icon}</span>
                      <span className="font-medium">{title}</span>
                      {(event.data as { criteriaName?: string }).criteriaName && (
                        <Badge variant="outline" className="text-xs">{(event.data as { criteriaName?: string }).criteriaName}</Badge>
                      )}
                    </div>
                    <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-inherit">
                      {event.step === 'found_listings' && (event.data as { listings?: unknown[] }).listings && (
                        <div className="mt-3 grid gap-2">
                          {((event.data as { listings: Array<{ id: string; data: Record<string, unknown> }> }).listings).map((listing, i) => (
                            <div key={i} className="bg-white p-3 rounded border text-sm">
                              <div className="font-medium">{String(listing.data.property_type || '')} - {String(listing.data.location_raw || 'Unknown')}</div>
                              <div className="text-gray-600 text-xs mt-1">
                                {listing.data.bedrooms ? `${String(listing.data.bedrooms)} BR • ` : null}
                                {listing.data.price_aed ? `AED ${Number(listing.data.price_aed).toLocaleString()}` : null}
                              </div>
                              {listing.data.message_body_clean ? (
                                <p className="text-xs text-gray-500 mt-2 line-clamp-2">{String(listing.data.message_body_clean).substring(0, 200)}...</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                      {event.step === 'debug_gemini_request' && (
                        <div className="mt-3 space-y-3">
                          <div>
                            <p className="text-sm font-medium mb-1">Listing:</p>
                            <pre className="bg-white p-2 rounded border text-xs">{JSON.stringify((event.data as { listingSummary?: object }).listingSummary, null, 2)}</pre>
                          </div>
                          <div>
                            <p className="text-sm font-medium mb-1">Prompt to Gemini:</p>
                            <pre className="bg-gray-900 text-green-400 p-3 rounded text-xs whitespace-pre-wrap font-mono max-h-64 overflow-auto">{(event.data as { prompt?: string }).prompt}</pre>
                          </div>
                        </div>
                      )}
                      {event.step === 'debug_gemini_response' && (
                        <div className="mt-3 space-y-3">
                          <div className="bg-white p-3 rounded border">
                            <div className="flex items-center gap-4 mb-2">
                              <span className="text-2xl font-bold">{((event.data as { parsedResult?: { score?: number } }).parsedResult?.score) || 0}%</span>
                              <Badge variant={((event.data as { parsedResult?: { score?: number } }).parsedResult?.score || 0) >= 60 ? "default" : "secondary"}>
                                {((event.data as { parsedResult?: { score?: number } }).parsedResult?.score || 0) >= 60 ? "Match" : "No Match"}
                              </Badge>
                            </div>
                            <p className="text-sm">{((event.data as { parsedResult?: { explanation?: string } }).parsedResult?.explanation)}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium mb-1">Raw Response:</p>
                            <pre className="bg-gray-900 text-green-400 p-3 rounded text-xs whitespace-pre-wrap font-mono max-h-48 overflow-auto">{JSON.stringify((event.data as { rawResponse?: object }).rawResponse, null, 2)}</pre>
                          </div>
                        </div>
                      )}
                      {!['found_listings', 'debug_gemini_request', 'debug_gemini_response'].includes(event.step) && (
                        <pre className="mt-3 bg-gray-900 text-green-400 p-3 rounded text-xs whitespace-pre-wrap font-mono max-h-64 overflow-auto">{JSON.stringify(event.data, null, 2)}</pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Search Criteria */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Search Criteria</CardTitle>
          <Button
            size="sm"
            onClick={() => {
              if (showCriteriaForm) {
                resetForm();
                setShowCriteriaForm(false);
              } else {
                resetForm();
                setShowCriteriaForm(true);
              }
            }}
          >
            {showCriteriaForm ? "Cancel" : "+ Add Criteria"}
          </Button>
        </CardHeader>
        <CardContent>
          {/* Add/Edit Criteria Form */}
          {showCriteriaForm && (
            <form
              onSubmit={handleSaveCriteria}
              className="border rounded-lg p-4 mb-6 bg-gray-50 space-y-4"
            >
              <h3 className="font-semibold text-lg">
                {editingCriteriaId ? "Edit Search Criteria" : "Add New Search Criteria"}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="criteria-name">Search Name *</Label>
                  <Input
                    id="criteria-name"
                    placeholder="e.g., 2BR Apartments in Marina"
                    value={criteriaForm.name}
                    onChange={(e) =>
                      setCriteriaForm({ ...criteriaForm, name: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label>Transaction Type</Label>
                  <Select
                    value={criteriaForm.transaction_type}
                    onValueChange={(value) =>
                      setCriteriaForm({ ...criteriaForm, transaction_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sale">Sale</SelectItem>
                      <SelectItem value="rent">Rent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Property Types</Label>
                <div className="flex flex-wrap gap-2">
                  {PROPERTY_TYPES.map((type) => (
                    <Badge
                      key={type}
                      variant={
                        criteriaForm.property_types.includes(type)
                          ? "default"
                          : "outline"
                      }
                      className="cursor-pointer capitalize"
                      onClick={() => togglePropertyType(type)}
                    >
                      {type}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Location Search with PSL Codes */}
              <div className="space-y-2">
                <Label>Locations / Communities</Label>
                <LocationSearch
                  selectedLocations={selectedLocations}
                  onLocationsChange={setSelectedLocations}
                  placeholder="Search for Jebel Ali, Dubai Investment Park, etc..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bedrooms">Bedrooms</Label>
                  <Input
                    id="bedrooms"
                    placeholder="e.g., 1,2,3"
                    value={criteriaForm.bedrooms}
                    onChange={(e) =>
                      setCriteriaForm({ ...criteriaForm, bedrooms: e.target.value })
                    }
                  />
                  <p className="text-xs text-gray-500">Comma-separated</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="min-price">Min Price (AED)</Label>
                  <Input
                    id="min-price"
                    type="number"
                    placeholder="e.g., 1000000"
                    value={criteriaForm.min_price_aed}
                    onChange={(e) =>
                      setCriteriaForm({
                        ...criteriaForm,
                        min_price_aed: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max-price">Max Price (AED)</Label>
                  <Input
                    id="max-price"
                    type="number"
                    placeholder="e.g., 5000000"
                    value={criteriaForm.max_price_aed}
                    onChange={(e) =>
                      setCriteriaForm({
                        ...criteriaForm,
                        max_price_aed: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="keywords">Keywords</Label>
                  <Input
                    id="keywords"
                    placeholder="e.g., sea view, upgraded"
                    value={criteriaForm.keywords}
                    onChange={(e) =>
                      setCriteriaForm({ ...criteriaForm, keywords: e.target.value })
                    }
                  />
                </div>
              </div>

              {/* Area Range */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min-area">Min Area (sqft)</Label>
                  <Input
                    id="min-area"
                    type="number"
                    placeholder="e.g., 5000"
                    value={criteriaForm.min_area_sqft}
                    onChange={(e) =>
                      setCriteriaForm({
                        ...criteriaForm,
                        min_area_sqft: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-area">Max Area (sqft)</Label>
                  <Input
                    id="max-area"
                    type="number"
                    placeholder="e.g., 50000"
                    value={criteriaForm.max_area_sqft}
                    onChange={(e) =>
                      setCriteriaForm({
                        ...criteriaForm,
                        max_area_sqft: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              {/* Boolean Filters */}
              <div className="space-y-3">
                <Label>Property Filters</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  <div className="flex items-center justify-between space-x-2 bg-white p-2 rounded border">
                    <Label htmlFor="is_off_plan" className="text-sm cursor-pointer">
                      Off-Plan
                    </Label>
                    <Switch
                      id="is_off_plan"
                      checked={criteriaForm.is_off_plan === true}
                      onCheckedChange={(checked) =>
                        setCriteriaForm({
                          ...criteriaForm,
                          is_off_plan: checked ? true : null,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between space-x-2 bg-white p-2 rounded border">
                    <Label htmlFor="is_distressed_deal" className="text-sm cursor-pointer">
                      Below Market Deal
                    </Label>
                    <Switch
                      id="is_distressed_deal"
                      checked={criteriaForm.is_distressed_deal === true}
                      onCheckedChange={(checked) =>
                        setCriteriaForm({
                          ...criteriaForm,
                          is_distressed_deal: checked ? true : null,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between space-x-2 bg-white p-2 rounded border">
                    <Label htmlFor="is_urgent" className="text-sm cursor-pointer">
                      Urgent
                    </Label>
                    <Switch
                      id="is_urgent"
                      checked={criteriaForm.is_urgent === true}
                      onCheckedChange={(checked) =>
                        setCriteriaForm({
                          ...criteriaForm,
                          is_urgent: checked ? true : null,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between space-x-2 bg-white p-2 rounded border">
                    <Label htmlFor="is_direct" className="text-sm cursor-pointer">
                      Direct
                    </Label>
                    <Switch
                      id="is_direct"
                      checked={criteriaForm.is_direct === true}
                      onCheckedChange={(checked) =>
                        setCriteriaForm({
                          ...criteriaForm,
                          is_direct: checked ? true : null,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between space-x-2 bg-white p-2 rounded border">
                    <Label htmlFor="has_maid_bedroom" className="text-sm cursor-pointer">
                      Maid Room
                    </Label>
                    <Switch
                      id="has_maid_bedroom"
                      checked={criteriaForm.has_maid_bedroom === true}
                      onCheckedChange={(checked) =>
                        setCriteriaForm({
                          ...criteriaForm,
                          has_maid_bedroom: checked ? true : null,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between space-x-2 bg-white p-2 rounded border">
                    <Label htmlFor="is_agent_covered" className="text-sm cursor-pointer">
                      Agent Covered
                    </Label>
                    <Switch
                      id="is_agent_covered"
                      checked={criteriaForm.is_agent_covered === true}
                      onCheckedChange={(checked) =>
                        setCriteriaForm({
                          ...criteriaForm,
                          is_agent_covered: checked ? true : null,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between space-x-2 bg-white p-2 rounded border">
                    <Label htmlFor="is_commission_split" className="text-sm cursor-pointer">
                      Commission Split
                    </Label>
                    <Switch
                      id="is_commission_split"
                      checked={criteriaForm.is_commission_split === true}
                      onCheckedChange={(checked) =>
                        setCriteriaForm({
                          ...criteriaForm,
                          is_commission_split: checked ? true : null,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between space-x-2 bg-white p-2 rounded border">
                    <Label htmlFor="is_mortgage_approved" className="text-sm cursor-pointer">
                      Mortgage Approved
                    </Label>
                    <Switch
                      id="is_mortgage_approved"
                      checked={criteriaForm.is_mortgage_approved === true}
                      onCheckedChange={(checked) =>
                        setCriteriaForm({
                          ...criteriaForm,
                          is_mortgage_approved: checked ? true : null,
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              {/* AI Prompt */}
              <div className="space-y-2">
                <Label htmlFor="ai_prompt">AI Qualification Prompt</Label>
                <Textarea
                  id="ai_prompt"
                  placeholder="e.g., How many persons capacity does this labor camp have? Only qualify listings with 500+ person capacity. Also check if it has a kitchen facility."
                  value={criteriaForm.ai_prompt}
                  onChange={(e) =>
                    setCriteriaForm({ ...criteriaForm, ai_prompt: e.target.value })
                  }
                  rows={4}
                  className="resize-none"
                />
                <p className="text-xs text-gray-500">
                  This prompt will be sent to Gemini AI to qualify and score each search result.
                  Use it to filter based on criteria not available in structured fields (e.g., capacity, amenities).
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={!criteriaForm.name || isSaving}>
                  {isSaving ? "Saving..." : editingCriteriaId ? "Update Criteria" : "Save Criteria"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    resetForm();
                    setShowCriteriaForm(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {/* Existing Criteria Table */}
          {criteria.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No search criteria yet. Add criteria to start finding matches.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Filters</TableHead>
                  <TableHead className="text-center">Matches</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {criteria.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.property_types?.map((t) => (
                          <Badge key={t} variant="outline" className="text-xs capitalize">
                            {t}
                          </Badge>
                        ))}
                        {c.communities?.map((comm) => (
                          <Badge key={comm} variant="secondary" className="text-xs">
                            {comm}
                          </Badge>
                        ))}
                        {c.bedrooms && c.bedrooms.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {c.bedrooms.join(",")} BR
                          </Badge>
                        )}
                        {(c.min_price_aed || c.max_price_aed) && (
                          <Badge variant="outline" className="text-xs">
                            {c.min_price_aed ? formatPrice(c.min_price_aed) : "Any"} -{" "}
                            {c.max_price_aed ? formatPrice(c.max_price_aed) : "Any"}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">
                        {c.matches?.[0]?.count || 0}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={c.is_active ? "default" : "secondary"}>
                        {c.is_active ? "Active" : "Paused"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditCriteria(c)}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Matches */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Matches</CardTitle>
          <Link href="/matches">
            <Button variant="outline" size="sm">
              View All
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recentMatches.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No matches yet. Run a search to find matching properties.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead>Criteria</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMatches.map((match) => {
                  const data = match.listing_data as {
                    data?: {
                      bedrooms?: number[];
                      property_type?: string[];
                      location_raw?: string;
                      price_aed?: number;
                    };
                  };
                  const listingData = data?.data || {};

                  return (
                    <TableRow key={match.id}>
                      <TableCell>
                        <div className="font-medium">
                          {listingData.bedrooms?.[0] || "?"} BR{" "}
                          {listingData.property_type?.[0] || "Property"}
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600">
                        {listingData.location_raw || "Unknown"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {listingData.price_aed
                          ? formatPrice(listingData.price_aed)
                          : "N/A"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={
                            (match.relevance_score || 0) >= 90
                              ? "default"
                              : "secondary"
                          }
                        >
                          {match.relevance_score || 0}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-500 text-sm">
                        {(match as Match & { criteria?: { name: string } }).criteria?.name || "Unknown"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
