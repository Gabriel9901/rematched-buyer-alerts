"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { PLACEHOLDER_DOCS, DEFAULT_SYSTEM_PROMPT } from "@/lib/gemini/promptTemplate";

interface PromptData {
  template: string;
  version: number;
  placeholders: typeof PLACEHOLDER_DOCS;
  updatedAt: string | null;
  isDefault: boolean;
}

export default function SettingsPage() {
  const [promptData, setPromptData] = useState<PromptData | null>(null);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showPlaceholderRef, setShowPlaceholderRef] = useState(false);
  const [applyingToAll, setApplyingToAll] = useState(false);

  const fetchPromptData = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/prompt");
      if (response.ok) {
        const data = await response.json();
        setPromptData(data);
        setEditedPrompt(data.template);
      }
    } catch (error) {
      console.error("Error fetching prompt data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPromptData();
  }, [fetchPromptData]);

  const promptHasRequiredPlaceholders = (prompt: string) => {
    const hasBuyerPlaceholder = PLACEHOLDER_DOCS.buyer_requirements.some((p) =>
      prompt.includes(p.name)
    );
    const hasListingPlaceholder = PLACEHOLDER_DOCS.listing_data.some((p) =>
      prompt.includes(p.name)
    );
    return hasBuyerPlaceholder && hasListingPlaceholder;
  };

  const handleSavePrompt = async () => {
    if (!promptHasRequiredPlaceholders(editedPrompt)) {
      alert("The prompt must contain at least one placeholder from each category!");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/settings/prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: editedPrompt }),
      });

      if (response.ok) {
        await fetchPromptData();
        setIsEditing(false);
      } else {
        const error = await response.json();
        alert(`Failed to save: ${error.error}`);
      }
    } catch (error) {
      console.error("Error saving prompt:", error);
      alert("Failed to save prompt");
    } finally {
      setSaving(false);
    }
  };

  const handleApplyToAll = async () => {
    if (
      !confirm(
        "This will reset ALL buyers to use the default prompt. Any buyer-specific customizations will be lost. Continue?"
      )
    ) {
      return;
    }

    setApplyingToAll(true);
    try {
      const response = await fetch("/api/settings/prompt/apply-all", {
        method: "POST",
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Success! ${data.resetCount} buyer(s) reset to default prompt.`);
      } else {
        alert("Failed to apply to all buyers");
      }
    } catch (error) {
      console.error("Error applying to all:", error);
      alert("Failed to apply to all buyers");
    } finally {
      setApplyingToAll(false);
    }
  };

  const handleResetToHardcoded = () => {
    if (confirm("Reset to the built-in default prompt?")) {
      setEditedPrompt(DEFAULT_SYSTEM_PROMPT);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse text-gray-500">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-2">Settings</h1>
        </div>
      </div>

      {/* Default System Prompt */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle>Default AI System Prompt</CardTitle>
              {promptData && (
                <Badge variant="outline">Version {promptData.version}</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {!isEditing && (
                <Button variant="outline" onClick={() => setIsEditing(true)}>
                  Edit Default Prompt
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleApplyToAll}
                disabled={applyingToAll}
              >
                {applyingToAll ? "Applying..." : "Apply to All Buyers"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            This is the default system prompt used for AI qualification. Buyers
            without a custom prompt will use this template.
          </p>

          {promptData?.updatedAt && (
            <p className="text-xs text-gray-500">
              Last updated: {new Date(promptData.updatedAt).toLocaleString()}
            </p>
          )}

          {isEditing ? (
            <>
              {/* Placeholder Reference - Collapsible */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowPlaceholderRef(!showPlaceholderRef)}
                  className="w-full px-4 py-3 bg-gray-100 flex items-center justify-between text-left hover:bg-gray-150"
                >
                  <span className="font-medium text-gray-900">
                    📝 Available Placeholders
                  </span>
                  <span className="text-gray-600">
                    {showPlaceholderRef ? "▼" : "▶"}
                  </span>
                </button>
                {showPlaceholderRef && (
                  <div className="p-4 bg-white grid md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium text-purple-900 mb-2">
                        Buyer Requirements
                      </h4>
                      <div className="space-y-1 text-sm">
                        {PLACEHOLDER_DOCS.buyer_requirements.map((p) => (
                          <div key={p.name} className="flex gap-2">
                            <code className="bg-purple-100 px-1 rounded text-purple-700 text-xs whitespace-nowrap">
                              {p.name}
                            </code>
                            <span className="text-gray-600 text-xs">
                              {p.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-blue-900 mb-2">
                        Listing Data
                      </h4>
                      <div className="space-y-1 text-sm">
                        {PLACEHOLDER_DOCS.listing_data.map((p) => (
                          <div key={p.name} className="flex gap-2">
                            <code className="bg-blue-100 px-1 rounded text-blue-700 text-xs whitespace-nowrap">
                              {p.name}
                            </code>
                            <span className="text-gray-600 text-xs">
                              {p.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {!promptHasRequiredPlaceholders(editedPrompt) && (
                <div className="bg-red-100 border border-red-300 rounded-lg p-3 text-sm">
                  <p className="font-medium text-red-800 mb-1">
                    ⚠️ Missing Required Placeholders
                  </p>
                  <p className="text-red-700">
                    The prompt must include at least one buyer requirement
                    placeholder and one listing placeholder.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Prompt Template</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetToHardcoded}
                    className="text-gray-500"
                  >
                    Reset to Built-in Default
                  </Button>
                </div>
                <Textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  rows={20}
                  className="font-mono text-sm"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleSavePrompt}
                  disabled={
                    saving || !promptHasRequiredPlaceholders(editedPrompt)
                  }
                >
                  {saving ? "Saving..." : "Save Default Prompt"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditedPrompt(promptData?.template || DEFAULT_SYSTEM_PROMPT);
                    setIsEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="bg-gray-50 rounded-lg p-4">
              <pre className="text-sm font-mono whitespace-pre-wrap text-gray-700 max-h-96 overflow-auto">
                {promptData?.template || DEFAULT_SYSTEM_PROMPT}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How Prompt Templates Work</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-600 space-y-3">
            <p>
              <strong>Default Prompt:</strong> The global template used for all
              buyers who don&apos;t have a custom prompt set.
            </p>
            <p>
              <strong>Buyer-Specific Prompts:</strong> Each buyer can have their
              own custom prompt that overrides the default. Edit these on the
              individual buyer pages.
            </p>
            <p>
              <strong>Criteria AI Prompt:</strong> Additionally, each search
              criteria can have an &quot;AI Qualification Prompt&quot; field for
              per-search customization (e.g., &quot;only qualify listings with
              500+ capacity&quot;). This gets added to the{" "}
              <code className="bg-gray-200 px-1 rounded">{"{additional_notes}"}</code>{" "}
              placeholder.
            </p>
            <p>
              <strong>Apply to All:</strong> Use this to reset all buyers to use
              the default prompt, removing any buyer-specific customizations.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
