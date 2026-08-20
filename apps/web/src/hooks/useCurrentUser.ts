import { useOutletContext } from "react-router-dom";
import type { UserDTO } from "@poup/shared";

export interface AppOutletContext {
  user: UserDTO;
}

/**
 * O usuário autenticado, vindo do `AppLayout`.
 *
 * As páginas chamavam `fetchMe()` por conta própria só para exibir o primeiro
 * nome — uma requisição a mais para um dado que o `App` já tinha em mãos desde
 * o login.
 */
export function useCurrentUser(): UserDTO {
  return useOutletContext<AppOutletContext>().user;
}
