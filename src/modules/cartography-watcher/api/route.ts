import {
  CartographyWatcherController,
  type CartographyWatcherRequestBody,
} from "../controllers/CartographyWatcherController";

export type { CartographyWatcherRequestBody };

const controller = new CartographyWatcherController();

export async function GET(request: Request): Promise<Response> {
  return controller.handleGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return controller.handlePost(request);
}
