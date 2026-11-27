import React from 'react';
import { notFound } from 'next/navigation';
import { RTIFinanceWorkstation } from '@/components/finance/RTIFinanceWorkstation';
import { RTI_FINANCE_MENUS, type FinanceMenuId } from '@/lib/rti-finance-core';

export default async function RTIFinanceMenuPage({
  params,
}: {
  params: Promise<{ menuId: string }>;
}) {
  const { menuId } = await params;
  const upper = menuId.toUpperCase();
  const matched =
    RTI_FINANCE_MENUS.find(m => m.id === upper || m.slug === menuId.toLowerCase());
  if (!matched) notFound();
  return <RTIFinanceWorkstation initialMenu={matched.id as FinanceMenuId} />;
}
