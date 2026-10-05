import { FinanceApp } from "@/components/finance/finance-app"
import type { NoSaleAccount, NoSaleListingStatusFilter, NoSaleThreshold } from "@/types/no-sale-listings"

export default async function NoSaleListingsRoute({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  return (
    <FinanceApp
      initialView="product-intelligence"
      initialProductIntelligenceSection="no-sale"
      initialProductIntelligenceState={{
        noSale: {
          filters: {
            account: account(query.account),
            days: days(query.days),
            listingStatus: listingStatus(query.listingStatus),
          },
          search: scalar(query.search),
        },
      }}
    />
  )
}

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function account(value: string | string[] | undefined): NoSaleAccount {
  return value === "C1" || value === "C2" ? value : "ALL"
}

function days(value: string | string[] | undefined): NoSaleThreshold {
  return value === "60" ? 60 : value === "90" ? 90 : 30
}

function listingStatus(value: string | string[] | undefined): NoSaleListingStatusFilter {
  return value === "PAUSED" || value === "INACTIVE" || value === "ALL" ? value : "ACTIVE"
}
