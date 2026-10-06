import { NextRequest, NextResponse } from "next/server";
import ordersData from "@/lib/orders.json";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("order_id")?.toUpperCase().trim();

  if (!orderId) {
    return NextResponse.json(
      { error: "Order ID is required." },
      { status: 400 }
    );
  }

  const orders = ordersData as Record<string, any>;
  const order = orders[orderId];

  if (!order) {
    return NextResponse.json({
      found: false,
      message: `No order found for ID: ${orderId}. Please verify the order number with the customer.`
    });
  }

  return NextResponse.json({
    found: true,
    order_id: orderId,
    ...order
  });
}