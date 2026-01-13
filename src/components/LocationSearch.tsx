"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Location {
  name: string;
  pslCode: string;
  address: string;
}

interface LocationSearchProps {
  selectedLocations: Location[];
  onLocationsChange: (locations: Location[]) => void;
  placeholder?: string;
}

export function LocationSearch({
  selectedLocations,
  onLocationsChange,
  placeholder = "Search for locations...",
}: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/locations?q=${encodeURIComponent(query)}`);
        if (response.ok) {
          const data = await response.json();
          // Filter out already selected locations
          const filtered = (data.locations || []).filter(
            (loc: Location) => !selectedLocations.some((s) => s.pslCode === loc.pslCode)
          );
          setSuggestions(filtered);
        }
      } catch (error) {
        console.error("Location search error:", error);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, selectedLocations]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (location: Location) => {
    onLocationsChange([...selectedLocations, location]);
    setQuery("");
    setSuggestions([]);
  };

  const handleRemove = (pslCode: string) => {
    onLocationsChange(selectedLocations.filter((loc) => loc.pslCode !== pslCode));
  };

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Selected locations */}
      {selectedLocations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedLocations.map((location) => (
            <Badge
              key={location.pslCode}
              variant="default"
              className="cursor-pointer hover:bg-red-600"
              onClick={() => handleRemove(location.pslCode)}
              title="Click to remove"
            >
              {location.name} ✕
            </Badge>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          placeholder={placeholder}
          className="w-full"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full" />
          </div>
        )}

        {/* Suggestions dropdown */}
        {showDropdown && suggestions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
            {suggestions.map((location) => (
              <button
                key={location.pslCode}
                type="button"
                onClick={() => handleSelect(location)}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
              >
                <div className="font-medium text-gray-900">{location.name}</div>
                <div className="text-sm text-gray-500">{location.address}</div>
              </button>
            ))}
          </div>
        )}

        {/* No results message */}
        {showDropdown && query.length >= 2 && !isLoading && suggestions.length === 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-sm text-gray-500 text-center">
            No locations found for &quot;{query}&quot;
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Search for communities, buildings, or areas. Selected locations use PSL codes for precise filtering.
      </p>
    </div>
  );
}
