"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";

interface Stats {
  totalBuyers: number;
  activeCriteria: number;
  todayMatches: number;
  totalMatches: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalBuyers: 0,
    activeCriteria: 0,
    todayMatches: 0,
    totalMatches: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isConfigured, setIsConfigured] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      if (!isSupabaseConfigured()) {
        setIsConfigured(false);
        setLoading(false);
        return;
      }

      try {
        // Fetch buyers count
        const { count: buyersCount } = await supabase
          .from("buyers")
          .select("*", { count: "exact", head: true });

        // Fetch active criteria count
        const { count: criteriaCount } = await supabase
          .from("buyer_criteria")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true);

        // Fetch total matches count
        const { count: matchesCount } = await supabase
          .from("matches")
          .select("*", { count: "exact", head: true });

        // Fetch today's matches count
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { count: todayCount } = await supabase
          .from("matches")
          .select("*", { count: "exact", head: true })
          .gte("created_at", today.toISOString());

        setStats({
          totalBuyers: buyersCount || 0,
          activeCriteria: criteriaCount || 0,
          todayMatches: todayCount || 0,
          totalMatches: matchesCount || 0,
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1">
            Monitor buyer alerts and property matches
          </p>
        </div>
        <Link href="/buyers/new">
          <Button>+ Add Buyer</Button>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Total Buyers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.totalBuyers}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Active Searches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.activeCriteria}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Today&apos;s Matches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">
              {stats.todayMatches}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Total Matches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.totalMatches}</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Link href="/buyers/new">
              <Button variant="outline">Add New Buyer</Button>
            </Link>
            <Link href="/buyers">
              <Button variant="outline">View All Buyers</Button>
            </Link>
            <Link href="/matches">
              <Button variant="outline">View All Matches</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Setup Instructions - only show if not configured */}
      {!isConfigured && (
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-blue-900">Setup Required</CardTitle>
          </CardHeader>
          <CardContent className="text-blue-800 space-y-2">
            <p>Complete these steps to get started:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                Create a new Supabase project and run the schema from{" "}
                <code className="bg-blue-100 px-1 rounded">supabase/schema.sql</code>
              </li>
              <li>
                Copy <code className="bg-blue-100 px-1 rounded">.env.example</code> to{" "}
                <code className="bg-blue-100 px-1 rounded">.env.local</code> and fill in your keys
              </li>
              <li>Add your Typesense scoped search key</li>
              <li>Add your Gemini API key</li>
              <li>Create a Slack webhook for notifications</li>
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
