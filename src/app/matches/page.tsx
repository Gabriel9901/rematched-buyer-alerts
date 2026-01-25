"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { generateContactMessage } from "@/lib/utils/agent-message-utils";
import { generateWhatsAppLink, generateTelegramLink } from "@/lib/utils/contact-links";

// Filter option types for typeahead
interface FilterOption {
  type: "buyer" | "criteria" | "all";
  id: string;
  label: string;
  sublabel?: string;
  count?: number;
}

interface MatchWithDetails {
  id: string;
  listing_id: string;
  listing_data: {
    data?: {
      property_type?: string[];
      community?: string;
      location_raw?: string;
      bedrooms?: number[];
      bathrooms?: number[];
      price_aed?: number;
      area_sqft?: number;
      message_body_clean?: string;
    };
  };
  relevance_score: number | null;
  qualification_notes: string | null;
  is_notified: boolean;
  created_at: string;
  criteria: {
    id: string;
    name: string;
    // Criteria fields for dynamic WhatsApp questions
    min_price_aed?: number | null;
    max_price_aed?: number | null;
    min_area_sqft?: number | null;
    max_area_sqft?: number | null;
    bedrooms?: number[] | null;
    bathrooms?: number[] | null;
    furnishing?: string[] | null;
    is_off_plan?: boolean | null;
    is_direct?: boolean | null;
    is_agent_covered?: boolean | null;
    buyer: {
      id: string;
      name: string;
    };
  };
}

type ViewMode = "flat" | "by-criteria" | "by-buyer";

interface GroupedMatches {
  key: string;
  label: string;
  sublabel?: string;
  matches: MatchWithDetails[];
}

interface ContactInfo {
  phone: string | null;
  username: string | null;
  source: string | null;
  whatsappLink: string | null;
  telegramLink: string | null;
}

function getScoreBadgeVariant(score: number): "default" | "secondary" | "destructive" | "outline" {
  if (score >= 80) return "default";
  if (score >= 60) return "secondary";
  return "outline";
}

function formatPrice(price: number): string {
  if (price >= 1000000) {
    return `AED ${(price / 1000000).toFixed(1)}M`;
  }
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(price);
}

function extractCapacity(message: string | undefined): number | null {
  if (!message) return null;
  const patterns = [
    /(\d{1,5})\s*[Pp]ersons?/,
    /[Cc]apacity[:\s]+(\d{1,5})/,
    /(\d{1,5})\s*[Bb]ed\s*[Ss]paces?/,
    /(\d{1,5})\s*people/,
    /[Aa]pproved\s+[Cc]apacity[:\s]+(\d{1,5})/,
  ];
  const numbers: number[] = [];
  for (const p of patterns) {
    const match = message.match(p);
    if (match) numbers.push(parseInt(match[1]));
  }
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

function extractRooms(message: string | undefined): number | null {
  if (!message) return null;
  const match = message.match(/(\d{1,4})\s*(?:total\s*)?rooms?/i);
  return match ? parseInt(match[1]) : null;
}

export default function MatchesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [matches, setMatches] = useState<MatchWithDetails[]>([]);
  const [contacts, setContacts] = useState<Record<string, ContactInfo>>({});
  const [loading, setLoading] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("by-criteria");
  const [deduplicateAcrossCriteria, setDeduplicateAcrossCriteria] = useState(true);

  // Collapsed groups state - tracks which groups are collapsed
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Typeahead filter state
  const [selectedFilter, setSelectedFilter] = useState<FilterOption | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchMatches() {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("matches")
          .select(`
            *,
            criteria:buyer_criteria(
              id,
              name,
              min_price_aed,
              max_price_aed,
              min_area_sqft,
              max_area_sqft,
              bedrooms,
              bathrooms,
              furnishing,
              is_off_plan,
              is_direct,
              is_agent_covered,
              buyer:buyers(id, name)
            )
          `)
          .order("created_at", { ascending: false })
          .limit(200);

        if (error) throw error;
        setMatches(data || []);
      } catch (error) {
        console.error("Error fetching matches:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchMatches();
  }, []);

  const fetchContacts = useCallback(async () => {
    if (matches.length === 0) return;

    setLoadingContacts(true);
    try {
      const unitIds = matches.map((m) => m.listing_id);
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitIds }),
      });

      if (response.ok) {
        const data = await response.json();
        setContacts(data.contacts || {});
      }
    } catch (error) {
      console.error("Error fetching contacts:", error);
    } finally {
      setLoadingContacts(false);
    }
  }, [matches]);

  // Click outside handler for dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        filterInputRef.current &&
        !filterInputRef.current.contains(event.target as Node)
      ) {
        setShowFilterDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Build filter options from matches (buyers and criteria with counts)
  const filterOptions = useMemo((): FilterOption[] => {
    const buyerMap = new Map<string, { name: string; count: number }>();
    const criteriaMap = new Map<string, { name: string; buyerName: string; count: number }>();

    for (const match of matches) {
      const buyerId = match.criteria?.buyer?.id;
      const buyerName = match.criteria?.buyer?.name;
      const criteriaId = match.criteria?.id;
      const criteriaName = match.criteria?.name;

      if (buyerId && buyerName) {
        const existing = buyerMap.get(buyerId);
        buyerMap.set(buyerId, {
          name: buyerName,
          count: (existing?.count || 0) + 1,
        });
      }

      if (criteriaId && criteriaName) {
        const existing = criteriaMap.get(criteriaId);
        criteriaMap.set(criteriaId, {
          name: criteriaName,
          buyerName: buyerName || "Unknown",
          count: (existing?.count || 0) + 1,
        });
      }
    }

    const options: FilterOption[] = [
      { type: "all", id: "all", label: "All Matches", count: matches.length },
    ];

    // Add buyers sorted by count
    const buyers = Array.from(buyerMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, { name, count }]): FilterOption => ({
        type: "buyer",
        id,
        label: name,
        count,
      }));

    // Add criteria sorted by count
    const criteria = Array.from(criteriaMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, { name, buyerName, count }]): FilterOption => ({
        type: "criteria",
        id,
        label: name,
        sublabel: buyerName,
        count,
      }));

    return [...options, ...buyers, ...criteria];
  }, [matches]);

  // Filter options by query for typeahead
  const filteredOptions = useMemo(() => {
    if (!filterQuery) return filterOptions;
    const query = filterQuery.toLowerCase();
    return filterOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        opt.sublabel?.toLowerCase().includes(query)
    );
  }, [filterOptions, filterQuery]);

  // Toggle group collapse
  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  // Handle filter selection
  const handleSelectFilter = useCallback((option: FilterOption) => {
    if (option.type === "all") {
      setSelectedFilter(null);
      setViewMode("flat");
    } else {
      setSelectedFilter(option);
      setViewMode(option.type === "buyer" ? "by-criteria" : "by-buyer");
    }
    setFilterQuery("");
    setShowFilterDropdown(false);
  }, []);

  // Clear filter
  const clearFilter = useCallback(() => {
    setSelectedFilter(null);
    setFilterQuery("");
  }, []);

  // Filter matches by search query AND selected filter (buyer/criteria)
  const filteredMatches = useMemo(() => {
    return matches.filter((match) => {
      // First, filter by selected buyer/criteria
      if (selectedFilter) {
        if (selectedFilter.type === "buyer") {
          if (match.criteria?.buyer?.id !== selectedFilter.id) return false;
        } else if (selectedFilter.type === "criteria") {
          if (match.criteria?.id !== selectedFilter.id) return false;
        }
      }

      // Then, filter by search query
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      const data = match.listing_data?.data || {};
      return (
        match.criteria?.buyer?.name?.toLowerCase().includes(query) ||
        match.criteria?.name?.toLowerCase().includes(query) ||
        data.community?.toLowerCase().includes(query) ||
        data.location_raw?.toLowerCase().includes(query) ||
        data.message_body_clean?.toLowerCase().includes(query)
      );
    });
  }, [matches, searchQuery, selectedFilter]);

  // Deduplicate matches by listing_id if deduplicateAcrossCriteria is enabled
  // Keeps the match with the highest relevance score
  const deduplicatedMatches = useMemo(() => {
    if (!deduplicateAcrossCriteria) return filteredMatches;

    const seenListings = new Map<string, MatchWithDetails>();
    for (const match of filteredMatches) {
      const existing = seenListings.get(match.listing_id);
      if (!existing || (match.relevance_score || 0) > (existing.relevance_score || 0)) {
        seenListings.set(match.listing_id, match);
      }
    }
    return Array.from(seenListings.values());
  }, [filteredMatches, deduplicateAcrossCriteria]);

  // Group matches by criteria or buyer
  const groupedMatches = useMemo((): GroupedMatches[] => {
    if (viewMode === "flat") {
      return [{
        key: "all",
        label: "All Matches",
        matches: deduplicatedMatches,
      }];
    }

    if (viewMode === "by-criteria") {
      const groups = new Map<string, GroupedMatches>();
      for (const match of deduplicatedMatches) {
        const criteriaId = match.criteria?.id || "unknown";
        const criteriaName = match.criteria?.name || "Unknown Criteria";
        const buyerName = match.criteria?.buyer?.name || "Unknown Buyer";

        if (!groups.has(criteriaId)) {
          groups.set(criteriaId, {
            key: criteriaId,
            label: criteriaName,
            sublabel: buyerName,
            matches: [],
          });
        }
        groups.get(criteriaId)!.matches.push(match);
      }
      return Array.from(groups.values()).sort((a, b) => b.matches.length - a.matches.length);
    }

    // by-buyer
    const groups = new Map<string, GroupedMatches>();
    for (const match of deduplicatedMatches) {
      const buyerId = match.criteria?.buyer?.id || "unknown";
      const buyerName = match.criteria?.buyer?.name || "Unknown Buyer";

      if (!groups.has(buyerId)) {
        groups.set(buyerId, {
          key: buyerId,
          label: buyerName,
          matches: [],
        });
      }
      groups.get(buyerId)!.matches.push(match);
    }
    return Array.from(groups.values()).sort((a, b) => b.matches.length - a.matches.length);
  }, [deduplicatedMatches, viewMode]);

  // Collapse/expand all groups (must be after groupedMatches)
  const collapseAllGroups = useCallback(() => {
    const allKeys = new Set(groupedMatches.map((g) => g.key));
    setCollapsedGroups(allKeys);
  }, [groupedMatches]);

  const expandAllGroups = useCallback(() => {
    setCollapsedGroups(new Set());
  }, []);

  // Check if all groups are collapsed
  const allCollapsed = useMemo(() => {
    if (groupedMatches.length === 0) return false;
    return groupedMatches.every((g) => collapsedGroups.has(g.key));
  }, [groupedMatches, collapsedGroups]);

  // Stats for the header
  const stats = useMemo(() => {
    const uniqueListings = new Set(filteredMatches.map((m) => m.listing_id)).size;
    const uniqueCriteria = new Set(filteredMatches.map((m) => m.criteria?.id)).size;
    const uniqueBuyers = new Set(filteredMatches.map((m) => m.criteria?.buyer?.id)).size;
    const duplicateCount = filteredMatches.length - deduplicatedMatches.length;
    return { uniqueListings, uniqueCriteria, uniqueBuyers, duplicateCount };
  }, [filteredMatches, deduplicatedMatches]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse text-gray-500">Loading matches...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Matches</h1>
          <p className="text-gray-500 mt-1">
            {stats.uniqueListings} unique listing{stats.uniqueListings !== 1 ? "s" : ""} across {stats.uniqueCriteria} criteria from {stats.uniqueBuyers} buyer{stats.uniqueBuyers !== 1 ? "s" : ""}
            {stats.duplicateCount > 0 && deduplicateAcrossCriteria && (
              <span className="text-orange-600"> ({stats.duplicateCount} duplicate{stats.duplicateCount !== 1 ? "s" : ""} hidden)</span>
            )}
          </p>
        </div>
        <Button
          onClick={fetchContacts}
          disabled={loadingContacts || matches.length === 0}
          variant="outline"
        >
          {loadingContacts ? "Loading..." : "Load Contacts"}
        </Button>
      </div>

      {/* Search and View Controls */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Typeahead Filter */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Filter:</span>
                {selectedFilter ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                    <Badge variant={selectedFilter.type === "buyer" ? "default" : "secondary"} className="text-xs">
                      {selectedFilter.type === "buyer" ? "Buyer" : "Criteria"}
                    </Badge>
                    <span className="text-sm font-medium text-blue-900">{selectedFilter.label}</span>
                    {selectedFilter.sublabel && (
                      <span className="text-xs text-blue-600">({selectedFilter.sublabel})</span>
                    )}
                    <button
                      onClick={clearFilter}
                      className="ml-1 text-blue-400 hover:text-blue-600"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      ref={filterInputRef}
                      placeholder="Search buyer or criteria..."
                      value={filterQuery}
                      onChange={(e) => {
                        setFilterQuery(e.target.value);
                        setShowFilterDropdown(true);
                      }}
                      onFocus={() => setShowFilterDropdown(true)}
                      className="w-64"
                    />
                    {showFilterDropdown && (
                      <div
                        ref={dropdownRef}
                        className="absolute z-50 mt-1 w-80 max-h-80 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg"
                      >
                        {filteredOptions.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500">No matches found</div>
                        ) : (
                          <>
                            {/* All option */}
                            {filteredOptions.filter(o => o.type === "all").map((option) => (
                              <button
                                key={option.id}
                                onClick={() => handleSelectFilter(option)}
                                className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between border-b"
                              >
                                <span className="font-medium text-gray-900">{option.label}</span>
                                <Badge variant="outline" className="text-xs">{option.count}</Badge>
                              </button>
                            ))}

                            {/* Buyers section */}
                            {filteredOptions.some(o => o.type === "buyer") && (
                              <div className="border-b">
                                <div className="px-4 py-1.5 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                  Buyers
                                </div>
                                {filteredOptions.filter(o => o.type === "buyer").map((option) => (
                                  <button
                                    key={option.id}
                                    onClick={() => handleSelectFilter(option)}
                                    className="w-full px-4 py-2 text-left hover:bg-blue-50 flex items-center justify-between"
                                  >
                                    <span className="text-gray-900">{option.label}</span>
                                    <Badge variant="secondary" className="text-xs">{option.count} matches</Badge>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Criteria section */}
                            {filteredOptions.some(o => o.type === "criteria") && (
                              <div>
                                <div className="px-4 py-1.5 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                  Criteria
                                </div>
                                {filteredOptions.filter(o => o.type === "criteria").map((option) => (
                                  <button
                                    key={option.id}
                                    onClick={() => handleSelectFilter(option)}
                                    className="w-full px-4 py-2 text-left hover:bg-blue-50 flex items-center justify-between"
                                  >
                                    <div>
                                      <div className="text-gray-900">{option.label}</div>
                                      {option.sublabel && (
                                        <div className="text-xs text-gray-500">{option.sublabel}</div>
                                      )}
                                    </div>
                                    <Badge variant="secondary" className="text-xs">{option.count} matches</Badge>
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Text search within filtered results */}
            <Input
              placeholder="Search within results..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">View:</span>
              <div className="flex rounded-md border border-gray-200">
                <button
                  onClick={() => setViewMode("by-criteria")}
                  className={`px-3 py-1.5 text-sm ${viewMode === "by-criteria" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"} rounded-l-md`}
                >
                  By Criteria
                </button>
                <button
                  onClick={() => setViewMode("by-buyer")}
                  className={`px-3 py-1.5 text-sm ${viewMode === "by-buyer" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"} border-l`}
                >
                  By Buyer
                </button>
                <button
                  onClick={() => setViewMode("flat")}
                  className={`px-3 py-1.5 text-sm ${viewMode === "flat" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"} rounded-r-md border-l`}
                >
                  Flat List
                </button>
              </div>
            </div>

            {/* Collapse/Expand toggle (only when not in flat mode) */}
            {viewMode !== "flat" && groupedMatches.length > 1 && (
              <button
                onClick={allCollapsed ? expandAllGroups : collapseAllGroups}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              >
                {allCollapsed ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    Expand All
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                    Collapse All
                  </>
                )}
              </button>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deduplicateAcrossCriteria}
                onChange={(e) => setDeduplicateAcrossCriteria(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">
                Hide duplicate listings
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Grouped Matches */}
      <div className="space-y-6">
        {groupedMatches.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">
              No matches found. Run a search from a buyer&apos;s page to find matches.
            </CardContent>
          </Card>
        ) : (
          groupedMatches.map((group) => {
            const isGroupCollapsed = collapsedGroups.has(group.key);

            return (
            <div key={group.key} className="space-y-4">
              {viewMode !== "flat" && (
                <button
                  onClick={() => toggleGroupCollapse(group.key)}
                  className="flex items-center gap-2 w-full text-left hover:bg-gray-50 px-2 py-1 -mx-2 rounded-lg transition-colors group"
                >
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isGroupCollapsed ? "" : "rotate-90"}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <h2 className="text-lg font-semibold">{group.label}</h2>
                  {group.sublabel && (
                    <Badge variant="outline" className="text-xs">{group.sublabel}</Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    {group.matches.length} match{group.matches.length !== 1 ? "es" : ""}
                  </Badge>
                </button>
              )}
              {viewMode === "flat" && (
                <h2 className="text-lg font-semibold">
                  {deduplicatedMatches.length} Match{deduplicatedMatches.length !== 1 ? "es" : ""}
                </h2>
              )}
              {!isGroupCollapsed && group.matches.map((match) => {
            const data = match.listing_data?.data || {};
            const contact = contacts[match.listing_id];
            const capacity = extractCapacity(data.message_body_clean);
            const rooms = extractRooms(data.message_body_clean);
            const isExpanded = expandedMatch === match.id;

            return (
              <Card key={match.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">
                        {data.location_raw || "Unknown Location"}
                      </CardTitle>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span>{match.criteria?.buyer?.name || "Unknown Buyer"}</span>
                        <span>•</span>
                        <Badge variant="outline" className="text-xs">
                          {match.criteria?.name || "Unknown Search"}
                        </Badge>
                      </div>
                    </div>
                    <Badge variant={getScoreBadgeVariant(match.relevance_score || 0)}>
                      {match.relevance_score || 0}% Match
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Key Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-gray-500">Price</p>
                      <p className="font-semibold">
                        {data.price_aed ? formatPrice(data.price_aed) : "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Area</p>
                      <p className="font-semibold">
                        {data.area_sqft ? `${data.area_sqft.toLocaleString()} sqft` : "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Capacity</p>
                      <p className="font-semibold">
                        {capacity ? `${capacity.toLocaleString()} persons` : "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Rooms</p>
                      <p className="font-semibold">
                        {rooms ? rooms.toLocaleString() : "N/A"}
                      </p>
                    </div>
                  </div>

                  {/* AI Analysis */}
                  {match.qualification_notes && (
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-xs font-medium text-blue-800 mb-1">AI Analysis</p>
                      <p className="text-sm text-blue-700">{match.qualification_notes}</p>
                    </div>
                  )}

                  {/* Description (expandable) */}
                  <div>
                    <button
                      onClick={() => setExpandedMatch(isExpanded ? null : match.id)}
                      className="text-xs font-medium text-gray-500 hover:text-gray-700"
                    >
                      {isExpanded ? "▼ Hide Description" : "▶ Show Description"}
                    </button>
                    {isExpanded && data.message_body_clean && (
                      <div className="mt-2 bg-gray-50 rounded-lg p-3">
                        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">
                          {data.message_body_clean}
                        </pre>
                      </div>
                    )}
                  </div>

                  {/* Contact */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="text-sm text-gray-500">
                      Matched {new Date(match.created_at).toLocaleDateString()}
                    </div>
                    <div className="flex items-center gap-2">
                      {contact ? (
                        (() => {
                          // Generate contextual message for this listing with dynamic questions
                          const message = generateContactMessage(match.listing_data, contact.source, match.criteria);
                          const hasWhatsApp = !!contact.phone;
                          const hasTelegram = !!contact.username;

                          if (!hasWhatsApp && !hasTelegram) {
                            return <span className="text-sm text-gray-400">No contact available</span>;
                          }

                          return (
                            <>
                              {hasWhatsApp && (
                                <a
                                  href={generateWhatsAppLink(contact.phone!, message)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
                                >
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                  </svg>
                                  WhatsApp
                                </a>
                              )}
                              {hasTelegram && (
                                <a
                                  href={generateTelegramLink(contact.username!, message)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600"
                                >
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                                  </svg>
                                  Telegram
                                </a>
                              )}
                            </>
                          );
                        })()
                      ) : (
                        <span className="text-sm text-gray-400">
                          {loadingContacts ? "Loading..." : "Click 'Load Contacts'"}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
            </div>
          );})
        )}
      </div>
    </div>
  );
}
