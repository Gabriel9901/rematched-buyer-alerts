"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";

export default function NewBuyerPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    slack_channel: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!isSupabaseConfigured()) {
        throw new Error("Supabase not configured");
      }

      const { data, error } = await supabase
        .from("buyers")
        .insert({
          name: formData.name,
          slack_channel: formData.slack_channel || null,
        })
        .select()
        .single();

      if (error) throw error;

      router.push(`/buyers/${data.id}`);
    } catch (error) {
      console.error("Failed to create buyer:", error);
      alert("Failed to create buyer: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/buyers"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to Buyers
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Add New Buyer</h1>
        <p className="text-gray-500 mt-1">
          Create a buyer profile to set up property alerts
        </p>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Buyer Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="e.g., John Smith"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slack_channel">Slack Channel (Optional)</Label>
              <Input
                id="slack_channel"
                placeholder="e.g., #buyer-alerts or @username"
                value={formData.slack_channel}
                onChange={(e) =>
                  setFormData({ ...formData, slack_channel: e.target.value })
                }
              />
              <p className="text-sm text-gray-500">
                Notifications will be sent to this Slack channel when matches
                are found
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={loading || !formData.name}>
                {loading ? "Creating..." : "Create Buyer"}
              </Button>
              <Link href="/buyers">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Next Steps */}
      <Card className="bg-gray-50">
        <CardHeader>
          <CardTitle className="text-lg">Next Steps</CardTitle>
        </CardHeader>
        <CardContent className="text-gray-600">
          <p>
            After creating the buyer, you&apos;ll be able to add search criteria
            to define what properties they&apos;re looking for.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
