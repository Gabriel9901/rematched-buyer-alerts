"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";

interface BuyerWithStats {
  id: string;
  name: string;
  slack_channel: string | null;
  created_at: string;
  criteria_count: number;
  match_count: number;
}

export default function BuyersPage() {
  const [buyers, setBuyers] = useState<BuyerWithStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBuyers() {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }

      try {
        // Fetch buyers with criteria and match counts
        const { data: buyersData, error } = await supabase
          .from("buyers")
          .select(`
            *,
            buyer_criteria(
              id,
              matches(count)
            )
          `)
          .order("created_at", { ascending: false });

        if (error) throw error;

        // Transform data to include counts
        const transformedBuyers: BuyerWithStats[] = (buyersData || []).map((buyer) => {
          const criteriaList = buyer.buyer_criteria || [];
          const criteriaCount = criteriaList.length;
          const matchCount = criteriaList.reduce((sum: number, c: { matches?: { count: number }[] }) => {
            return sum + (c.matches?.[0]?.count || 0);
          }, 0);

          return {
            id: buyer.id,
            name: buyer.name,
            slack_channel: buyer.slack_channel,
            created_at: buyer.created_at,
            criteria_count: criteriaCount,
            match_count: matchCount,
          };
        });

        setBuyers(transformedBuyers);
      } catch (error) {
        console.error("Error fetching buyers:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchBuyers();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse text-gray-500">Loading buyers...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Buyers</h1>
          <p className="text-gray-500 mt-1">Manage buyer profiles and search criteria</p>
        </div>
        <Link href="/buyers/new">
          <Button>+ Add Buyer</Button>
        </Link>
      </div>

      {/* Buyers Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Buyers ({buyers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {buyers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No buyers yet. Add your first buyer to get started.</p>
              <Link href="/buyers/new" className="mt-4 inline-block">
                <Button variant="outline">Add Buyer</Button>
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slack Channel</TableHead>
                  <TableHead className="text-center">Searches</TableHead>
                  <TableHead className="text-center">Matches</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyers.map((buyer) => (
                  <TableRow key={buyer.id}>
                    <TableCell className="font-medium">{buyer.name}</TableCell>
                    <TableCell>
                      {buyer.slack_channel ? (
                        <Badge variant="secondary">{buyer.slack_channel}</Badge>
                      ) : (
                        <span className="text-gray-400">None</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {buyer.criteria_count}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{buyer.match_count}</Badge>
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {new Date(buyer.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Link href={`/buyers/${buyer.id}`}>
                        <Button variant="ghost" size="sm">
                          View →
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
