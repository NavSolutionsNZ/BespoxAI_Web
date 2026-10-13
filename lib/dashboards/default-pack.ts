import type { DashboardSpec } from './types'

/** The system default CFO dashboard. Users get a copy on first edit (later slice). */
export const DEFAULT_CFO_PACK: DashboardSpec = {
  version: 1,
  name: 'CFO overview',
  sections: [
    {
      id: 'pl', title: 'Profit & loss',
      widgets: [
        { id: 'pl-rev', type: 'kpi', title: 'Revenue this month', metricId: 'pl_revenue', params: { period: 'this_month', compare: 'prior_period' }, width: 4 },
        { id: 'pl-gm', type: 'kpi', title: 'Gross margin this month', metricId: 'pl_gross_margin', params: { period: 'this_month', compare: 'prior_period' }, width: 4 },
        { id: 'pl-net', type: 'kpi', title: 'Net profit this month', metricId: 'pl_net_profit', params: { period: 'this_month', compare: 'prior_period' }, width: 4 },
        { id: 'pl-sum', type: 'table', title: 'P&L this month vs last month', metricId: 'pl_summary', params: { period: 'this_month', compare: 'prior_period' }, width: 12 },
      ],
    },
    {
      id: 'cash', title: 'Cash & bank',
      widgets: [
        { id: 'cash-total', type: 'kpi', title: 'Cash & bank today', metricId: 'cash_total', width: 4 },
        { id: 'cash-trend', type: 'line', title: 'Cash at month end', metricId: 'cash_trend', width: 8 },
        { id: 'cash-acc', type: 'table', title: 'Balance by bank account', metricId: 'cash_by_account', width: 12 },
      ],
    },
    {
      id: 'arap', title: 'Debtors & creditors',
      widgets: [
        { id: 'ar-od', type: 'kpi', title: 'Overdue debtors', metricId: 'ar_overdue', width: 6 },
        { id: 'ap-od', type: 'kpi', title: 'Overdue creditors', metricId: 'ap_overdue', width: 6 },
        { id: 'ar-age', type: 'bar', title: 'Debtor aging', metricId: 'ar_aging', width: 6 },
        { id: 'ap-age', type: 'bar', title: 'Creditor aging', metricId: 'ap_aging', width: 6 },
      ],
    },
    {
      id: 'sales', title: 'Sales',
      widgets: [
        { id: 'sales-trend', type: 'line', title: 'Revenue by month', metricId: 'sales_trend', width: 6 },
        { id: 'top-cust', type: 'bar', title: 'Top 10 customers YTD', metricId: 'top_customers', params: { period: 'ytd', top: 10 }, width: 6 },
      ],
    },
  ],
}
