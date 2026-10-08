type ServiceabilityRecord = {
  city: string;
  state: string;
  estimated_delivery_days: number;
  cod_available: boolean;
};

type DiscountRecord = {
  minimum_order_value: number;
  percentage_off?: number;
  amount_off?: number;
};

const SERVICEABILITY_DATABASE: Record<string, ServiceabilityRecord> = {
  '400061': {
    city: 'Mumbai',
    state: 'Maharashtra',
    estimated_delivery_days: 3,
    cod_available: true,
  },
  '110001': {
    city: 'New Delhi',
    state: 'Delhi',
    estimated_delivery_days: 3,
    cod_available: true,
  },
  '560001': {
    city: 'Bengaluru',
    state: 'Karnataka',
    estimated_delivery_days: 4,
    cod_available: true,
  },
  '700001': {
    city: 'Kolkata',
    state: 'West Bengal',
    estimated_delivery_days: 4,
    cod_available: true,
  },
};

const DISCOUNT_DATABASE: Record<string, DiscountRecord> = {
  AURA20: { minimum_order_value: 499, percentage_off: 20 },
  WELCOME10: { minimum_order_value: 299, percentage_off: 10 },
  GLOW50: { minimum_order_value: 999, amount_off: 50 },
};

export function check_serviceability(pincode: string) {
  if (!/^\d{6}$/.test(pincode)) {
    return {
      success: false,
      serviceable: false,
      pincode,
      message: 'Enter a valid 6-digit Indian pincode.',
    };
  }

  const location = SERVICEABILITY_DATABASE[pincode];
  if (!location) {
    return {
      success: true,
      serviceable: false,
      pincode,
      message: 'Delivery is not currently available for this pincode.',
    };
  }

  return {
    success: true,
    serviceable: true,
    pincode,
    ...location,
    message: `Delivery is available in ${location.city}, ${location.state}.`,
  };
}

export function validate_discount(code: string, order_value: number) {
  const normalizedCode = code.trim().toUpperCase();
  if (!Number.isFinite(order_value) || order_value < 0) {
    return {
      success: false,
      valid: false,
      code: normalizedCode,
      message: 'Order value must be a valid non-negative number in INR.',
    };
  }

  const discount = Object.hasOwn(DISCOUNT_DATABASE, normalizedCode)
    ? DISCOUNT_DATABASE[normalizedCode]
    : undefined;
  if (!discount) {
    return {
      success: true,
      valid: false,
      code: normalizedCode,
      message: 'This promo code is not recognized.',
    };
  }

  if (order_value < discount.minimum_order_value) {
    return {
      success: true,
      valid: false,
      code: normalizedCode,
      minimum_order_value_inr: discount.minimum_order_value,
      message: `This code requires a minimum order value of ₹${discount.minimum_order_value}.`,
    };
  }

  const orderValuePaise = Math.round(order_value * 100);
  const discountPaise = discount.percentage_off
    ? Math.round((orderValuePaise * discount.percentage_off) / 100)
    : Math.min(Math.round((discount.amount_off ?? 0) * 100), orderValuePaise);
  const finalPricePaise = orderValuePaise - discountPaise;

  return {
    success: true,
    valid: true,
    code: normalizedCode,
    ...(discount.percentage_off ? { discount_percentage: discount.percentage_off } : {}),
    minimum_order_value_inr: discount.minimum_order_value,
    order_value_inr: orderValuePaise / 100,
    discount_amount_inr: discountPaise / 100,
    final_price_inr: finalPricePaise / 100,
    message: `Code ${normalizedCode} applied successfully.`,
  };
}
